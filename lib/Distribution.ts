import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Certificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { AllowedMethods, BehaviorOptions, CachePolicy, Distribution, DistributionProps, EdgeLambda, OriginBase, OriginRequestPolicy, PriceClass, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { IContext, Origin, OriginAlb, OriginFunctionUrl, OriginType } from '../context/IContext';
import { createEdgeFunctionForOriginRequest } from './EdgeFunctionOriginRequest';
import { createEdgeFunctionForViewerResponse } from './EdgeFunctionViewerResponse';
import { getAlbOrigin } from './OriginAlb';
import { getFunctionUrlOrigin } from './OriginFunctionUrl';
import { createARecord } from './Route53';
import { ParameterTester } from './Util';
import path = require('path');

/**
 * This construct creates the cloudfront distribution, along with the edge functions and origins that
 * it needs. Thus, all stack resources are accounted for here. 
 */
export class CloudfrontDistribution extends Construct {
  // The path of the origin request edge lambda code asset relative to the root of the project
  public static EDGE_ORIGIN_REQUEST_CODE_FILE:string = 'cdk.out/asset.origin.request/index.js';
  public static EDGE_VIEWER_RESPONSE_CODE_FILE:string = 'cdk.out/asset.viewer.response/index.js';
  
  private stack:Construct;
  private context:IContext;
  private edgeFunctionForOriginRequest:NodejsFunction|undefined;
  private edgeLambdas = [] as EdgeLambda[];
  private origin:OriginBase;
  private testOrigin:OriginBase;
  private cloudFrontDistribution:Distribution;

  constructor(stack: Construct, stackName: string, props?: any) {
    
    super(stack, stackName);

    this.stack = stack;

    this.context = stack.node.getContext('stack-parms');
    
    const { context } = this;
    const { validateContext, createDistribution, edgeLambdas } = this;
    const { REGION, ORIGIN } = context;
    const { originType } = (ORIGIN ?? {} as Origin);

    // 1) Validate context parameters
    validateContext();

    // 2) Create lambda@Edge functions
    const scope = REGION == 'us-east-1' ? stack : this;
    createEdgeFunctionForOriginRequest(scope, context, (edgeLambda:any) => {
      edgeLambdas.push(edgeLambda);
      this.edgeFunctionForOriginRequest = edgeLambda;
    });
    createEdgeFunctionForViewerResponse(scope, context, (edgeLambda:any) => {
      edgeLambdas.push(edgeLambda);
    });

    const { edgeFunctionForOriginRequest } = this;

    // 3) Create the primary origin if indicated.
    switch(originType) {
      case OriginType.ALB:
        this.origin = getAlbOrigin(ORIGIN as OriginAlb);
        break;
      case OriginType.FUNCTION_URL:
        this.origin = getFunctionUrlOrigin({
          stack, context, edgeFunctionForOriginRequest, origin:(ORIGIN as OriginFunctionUrl)
        }) as HttpOrigin;
        break;
      default:
        console.log('ORIGIN is not defined, using function url as test origin');
        break;
    };
    

    // 4) Create the test origin
    if(originType == OriginType.FUNCTION_URL) {
      this.testOrigin = this.origin;
    }
    else {
      const testOrigin = { originType:OriginType.FUNCTION_URL } as OriginFunctionUrl;
      this.testOrigin = getFunctionUrlOrigin({
        stack, context, edgeFunctionForOriginRequest, origin: testOrigin
      });
    }

    // 5) Create the distribution
    createDistribution();

    const { subdomain } = ORIGIN || {};
  
    // 6) Set relevant stack outputs
    if(subdomain) {
      new CfnOutput(stack, 'CloudFrontDistributionURL', {
        value: `https://${subdomain}`,
        description: 'CloudFront Distribution URL',
      });
    }
    else {
      new CfnOutput(stack, 'CloudFrontDistributionURL', {
        value: `https://${this.cloudFrontDistribution.distributionDomainName}`,
        description: 'CloudFront Distribution URL',
      });
    }
  }

  /**
   * Make sure there are no invalid combinations or omissions of context.json fields.
   */
  private validateContext = () => {
    const { context: { ORIGIN, DNS } } = this;
    const { isBlank, isNotBlank, anyBlank, someBlankSomeNot} = ParameterTester;
    const { certificateARN, hostedZone } = DNS || {};
    const { originType, arn, subdomain } = ORIGIN || {};

    const err = (msg:string) => { throw new Error(msg); }

    // An alb must be configured with dnsName and arn specified
    if(originType == OriginType.ALB) {
      const { dnsName } = (ORIGIN as OriginAlb);
      const msg = 'An alb origin was configured in context.json';
      if(isBlank(dnsName)) err(`${msg} without its dnsName value`);
      if(isBlank(arn)) err(`${msg} without its arn value`)
    }

    // DNS should not be partially configured - Certificate and Route53 must go together.
    if(someBlankSomeNot(certificateARN, hostedZone)) {
      throw new Error('hostedZone and certifidateARN are mutually inclusive');
    }

    // DNS should be configured if a subdomain is specified for the origin.
    if(isNotBlank(subdomain) && anyBlank(certificateARN, hostedZone)) {
      throw new Error('An origin subdomain must be supported by DNS.certificateARN and DNS.hostedZone');
    }

    // subdomain must be a subdomain of, or equal to, hostedZone
    if(isNotBlank(subdomain) && subdomain != hostedZone) {
      if( ! subdomain!.endsWith(`.${hostedZone}`)) {
        throw new Error(`${subdomain} is not a subdomain of ${hostedZone}`);
      }
    }
  }

  /**
   * Create the cloudfront distribution.
   * 
   * NOTE 1: VIEWER_REQUEST event type would have been preferable so that the edge lambda is hit despite what's in
   * the cache. However, that means a 1 MB code limit, which seems to be exceeded, making ORIGIN_REQUEST the
   * only choice with a 50 MB code limit. In order for the lambda get hit for EVERY request, caching is disabled.
   * 
   * NOTE 2: ALL_VIEWER_EXCEPT_HOST_HEADER will ensure the HTTP_HOST header contains the origins host domain, 
   * not the domain of the cloudfront distribution. This keeps lambda function url origins working correctly,
   */
  private createDistribution = () => {
    const { stack, context, origin, testOrigin, edgeLambdas } = this;
    const { isNotBlank, noneBlank } = ParameterTester;
    const { TAGS, STACK_ID, DNS, ORIGIN } = context;
    const { hostedZone, certificateARN } = DNS || {};
    const { subdomain } = ORIGIN || {};
    const distributionName = `${STACK_ID}-cloudfront-distribution-${TAGS.Landscape}`;
    const subdomains = [] as string[];
    
    if(isNotBlank(subdomain)) {
      subdomains.push(subdomain!);
    }
    else if(noneBlank(hostedZone, certificateARN)) {
      subdomains.push(`testing123.${hostedZone}`);
    }

    const customDomain = ():boolean => subdomains.length > 0;

    /**
     * Construct a behavior for the provided origin
     * @param origin 
     * @param customDomain 
     * @returns 
     */
    const getBehavior = (origin:OriginBase, customDomain:boolean):BehaviorOptions => {
      const { ALLOW_ALL, REDIRECT_TO_HTTPS } = ViewerProtocolPolicy;
      const { ALL_VIEWER, ALL_VIEWER_EXCEPT_HOST_HEADER } = OriginRequestPolicy
    
      return {
        origin,
        edgeLambdas,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: customDomain ? REDIRECT_TO_HTTPS : ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED, // See NOTE 1
        originRequestPolicy: customDomain ? ALL_VIEWER : ALL_VIEWER_EXCEPT_HOST_HEADER, // See NOTE 2
      } as BehaviorOptions
    }

    /**
     * @returns A behavior for the test origin if no primary origin is configured in context.json, 
     * else a behavior based on the configured origin.
     */
    const getDefaultBehavior = ():BehaviorOptions => {
      if(origin) {
        return getBehavior(origin, customDomain());
      }
      return getBehavior(testOrigin, false);
    }

    // Configure distribution properties
    let distributionProps = {
      priceClass: PriceClass.PRICE_CLASS_100,
      logBucket: new Bucket(stack, `${distributionName}-logs-bucket`, {
        removalPolicy: RemovalPolicy.DESTROY,    
        autoDeleteObjects: true,
        objectOwnership: ObjectOwnership.OBJECT_WRITER
      }),
      comment: `shib-lambda-${TAGS.Landscape}-distribution`,  
      domainNames: subdomains, 
      defaultBehavior: getDefaultBehavior(),
    } as DistributionProps

    if(origin) {
      // Associate the test origin with an additional behavior
      distributionProps = Object.assign({
        additionalBehaviors: {
          // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-values-specify.html#DownloadDistValuesPathPattern
          '/testing123': getBehavior(testOrigin, false),
          '/testing123/*': getBehavior(testOrigin, false)
        }
      }, distributionProps);
    }
    
    // Extend distribution properties to include certificate and domain if indicated.
    if( customDomain()) {
      const certificate:ICertificate = Certificate.fromCertificateArn(this, `${distributionName}-acm-cert`, certificateARN!);
      distributionProps = Object.assign({
        certificate, 
        domainNames: subdomains
      }, distributionProps);
    }

    // Create the cloudFront distribution
    this.cloudFrontDistribution = new Distribution(stack, distributionName, distributionProps);

    // Create an A record in route 53 with the distribution as the target.
    if(customDomain()) {
      createARecord({
        scope:this, 
        distribution:this.cloudFrontDistribution, 
        hostedZone: hostedZone!, 
        id: `${distributionName}-ARecord`,
        recordName: subdomains[0]
      });
    }
  }

}

