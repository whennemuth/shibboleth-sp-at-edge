import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CustomResourceConfig } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { BuildOptions, build } from 'esbuild';
import { CloudFrontCachingStrategy, IContext, OriginAlb, OriginType, SecretFieldNames } from '../context/IContext';
import { CloudfrontDistribution } from './Distribution';
import { albExists } from './OriginAlb';
import { findARecord } from './Route53';
import { SecretsManagerSecret } from './secrets/Secret';
import { BU_NameTagAspect, TaggingAspect } from './Tagging';
import { getClone, getStackName, logHeader } from './Util';
import { HttpOriginBase } from './Origin';

/**
 * @param scope - The parent construct (can be App, Stack, or other Construct)
 * @param id - The construct identifier
 * @param context - The Shibboleth configuration context
 */
export type ShibbolethAtEdgeConstructProps = {
  scope: Construct,
  id: string,
  context: IContext,
  httpOriginBase?: HttpOriginBase,
};

/**
 * A reusable construct that creates the complete Shibboleth infrastructure including:
 * - CloudFront distribution with Lambda@Edge functions
 * - Origin validation (ALB or Function URL)
 * - Route53 DNS validation
 * - Secrets Manager integration
 * - Lambda code building for edge functions
 * 
 * Can be used both as a standalone deployment or embedded within other stacks.
 */
export class ShibbolethAtEdgeConstruct extends Construct {

  private static ignoreRoute53: boolean = false;

  private _cloudfrontDistribution:CloudfrontDistribution;
  
  /**
   * Static factory method that performs all async validation and setup before creating the construct.
   * Use this instead of calling the constructor directly.
   * 
   * @param props - The construct properties
   * @returns Promise<ShibbolethAtEdgeConstruct> - The fully initialized construct
   */
  public static async getInstance(props: ShibbolethAtEdgeConstructProps): Promise<ShibbolethAtEdgeConstruct> {

    // Perform all async validation and setup
    const processedContext = await ShibbolethAtEdgeConstruct.performAsyncSetup(props.context);
    
    // Create and return the construct with the processed context
    return new ShibbolethAtEdgeConstruct({
      ...props,
      context: processedContext} satisfies ShibbolethAtEdgeConstructProps);
  }

  /**
   * Convenience method for creating a standalone stack with this construct.
   * 
   * @param props - The construct properties
   * @returns Promise<Stack> - A stack containing the Shibboleth construct
   */
  public static async createStack(props: ShibbolethAtEdgeConstructProps): Promise<Stack> {
    const { scope, context } = props;

    // Perform all async validation and setup
    const processedContext = await ShibbolethAtEdgeConstruct.performAsyncSetup(context);
    
    const { ACCOUNT: account, REGION: region, TAGS: { 
      Landscape, Function, Service, CostCenter='', Ticket='' 
    } } = processedContext;

    const stackName = getStackName(processedContext);
    
    const stack = new Stack(scope, stackName, {
      stackName,
      description: 'Lambda-based shibboleth service provider',
      env: { account, region },
      tags: { Service, Function, Landscape, CostCenter, Ticket },
    });
    
    // Create the construct within the stack
    new ShibbolethAtEdgeConstruct({
      ...props,
      scope: stack,
      context: processedContext} satisfies ShibbolethAtEdgeConstructProps);
    
    return stack;
  }

  /**
   * Private constructor - use getInstance() or createStack() instead
   */
  constructor(private props: ShibbolethAtEdgeConstructProps) {
    const { scope, id, context } = props;
    super(scope, id);
    
    // Configure custom resource defaults on the parent stack
    const construct = Stack.of(this);
    if (construct) {
      CustomResourceConfig.of(construct).addRemovalPolicy(RemovalPolicy.DESTROY);
      CustomResourceConfig.of(construct).addLogRetentionLifetime(RetentionDays.ONE_WEEK);
      
      // Set the tags for the stack
      var tags: object = context.TAGS;
      for (const [key, value] of Object.entries(tags)) {
        construct.tags.setTag(key, value);
      }

      // Apply standard tags to all resources
      const { TAGS: { Landscape, Function, Service, CostCenter='', Ticket='' } } = context;
      const standardTags = { Service, Function, Landscape, CostCenter, Ticket };
      new TaggingAspect(construct, standardTags).applyTags({ 
        aspect: new BU_NameTagAspect(standardTags) 
      });
    }

    // Set context for the construct
    this.node.setContext('stack-parms', context);

    // Create the CloudFront distribution (context is already validated)
    const distributionId = scope.node.id.endsWith('Stack') ? scope.node.id : 'Distribution';
    new CloudfrontDistribution(scope, distributionId, {
      ignoreRoute53: ShibbolethAtEdgeConstruct.ignoreRoute53,
      httpOriginBase: this.props.httpOriginBase
    });
  }

  /**
   * Performs all async validation and setup operations before construct creation
   */
  private static async performAsyncSetup(contextInput: IContext): Promise<IContext> {
    // Get an object that can be mutated.
    let context = getClone<IContext>(contextInput);

    const { 
      ACCOUNT: account, 
      REGION: region,
      SHIBBOLETH: { secret: { secretArn } },
      ORIGIN, 
      ORIGIN: { subdomain } = {},
      DNS: { hostedZone } = {}
    } = context;

    const dnsName = (ORIGIN as OriginAlb)?.dnsName;

    // Check if ALB exists and switch to Function URL if needed
    const missingAlb = ! (await albExists({ dnsName, region }));
    console.log(`ALB with DNS name ${dnsName} exists: ${!missingAlb}`);

    if( missingAlb && ORIGIN && `${ORIGIN.originType}`.toLowerCase() == OriginType.ALB ) {
      // Use a function URL as an origin. This could mean the ALB is still intended to be used,
      // but the stack in which the ALB is created has not been deployed yet.
      console.warn(`NOTICE: The ALB with DNS name ${dnsName} does not exist in region ${region}. ` +
        `\nSwitching the origin type to Function URL temporarily.`);
      context.ORIGIN!.originType = OriginType.FUNCTION_URL;
      context.CLOUDFRONT_CACHING_STRATEGY = CloudFrontCachingStrategy.NO_CACHE;
    }

    // Find out if an A record for the subdomain already exists AND was not created by this stack.
    if( subdomain && hostedZone ) {
      const record = await findARecord(hostedZone, subdomain, region);
      if(record.recordSet && ! record.createdByThisStack) {
        ShibbolethAtEdgeConstruct.ignoreRoute53 = true;
      }
    }
    
    // Validate secret exists
    await ShibbolethAtEdgeConstruct.validateSecret(secretArn, region);

    // Build Lambda@Edge functions if not in us-east-1
    await ShibbolethAtEdgeConstruct.buildEdgeFunctions(region);
    
    return context;
  }

  /**
   * Validates that the required Secrets Manager secret exists
   */
  private static async validateSecret(secretArn: string, region: string): Promise<void> {
    if( secretArn ) {
      // Make sure it exists.
      const exists = await new SecretsManagerSecret({ 
        secretName: secretArn, fldNames: {} as SecretFieldNames, region 
      }).exists();

      // Abort if the specified secret does not exist
      if( ! exists ) {
        logHeader('VALIDATION ERROR!!!')
        console.error(`The secret ${secretArn} does not exist. ` +
          `\nYou can create it by populating the ./.env file as directed in the README and running: ` +
          `\nnpm run create-secrets`);
        process.exit(1);
      }
    }
    else {
      logHeader('VALIDATION ERROR!!!')
      console.error(`SHIBBOLETH.secret.secretArn must be defined in ./context/context.json. ` +
        `\nIf this is because the secret does not exist in secrets manager yet, you can create it by populating ` +
        `\nthe ./.env file as directed in the README and running ` +
        `\nnpm run create-secrets`);
      process.exit(1);
    }
  }

  /**
   * Builds the Lambda@Edge functions when deploying outside us-east-1
   */
  private static async buildEdgeFunctions(region: string): Promise<void> {
    // Check the region
    if( region != 'us-east-1' ) {

      // Gotta build the lambda code asset manually due to using EdgeLambda instead of NodejsFunction
      const { 
        EDGE_VIEWER_REQUEST_CODE_FILE,
        EDGE_ORIGIN_REQUEST_CODE_FILE, 
        EDGE_VIEWER_RESPONSE_CODE_FILE 
      } = CloudfrontDistribution

      // Build viewer request.
      const viewerRequestBuildResult = await build({
        entryPoints: ['lib/lambda/FunctionSpViewerRequest.ts'],
        write: true,
        outfile: EDGE_VIEWER_REQUEST_CODE_FILE,
        bundle: true,
        platform: 'node'
      } as BuildOptions);

      // Abort if there were build errors
      (viewerRequestBuildResult.errors || []).forEach((error) => {
        console.error(`Error building viewer request: ${error}`);
        process.exit(1);
      });

      // Build viewer response.
      const originRequestBuildResult = await build({
        entryPoints: ['lib/lambda/FunctionSpOriginRequest.ts'],
        write: true,
        outfile: EDGE_ORIGIN_REQUEST_CODE_FILE,
        bundle: true,
        platform: 'node',
        external: ['@aws-sdk/*']
      } as BuildOptions);

      // Abort if there were build errors
      (originRequestBuildResult.errors || []).forEach((error) => {
        console.error(`Error building origin request: ${error}`);
        process.exit(1);
      });

      // Build origin request.
      const viewerResponseBuildResult = await build({
        entryPoints: ['lib/lambda/FunctionSpViewerResponse.ts'],
        write: true,
        outfile: EDGE_VIEWER_RESPONSE_CODE_FILE,
        bundle: true,
        platform: 'node'
      } as BuildOptions);

      // Abort if there were build errors
      (viewerResponseBuildResult.errors || []).forEach((error) => {
        console.error(`Error building viewer response: ${error}`);
        process.exit(1);
      });
    }
  }

  public get cloudfrontDistribution(): CloudfrontDistribution {
    return this._cloudfrontDistribution;
  }
}
