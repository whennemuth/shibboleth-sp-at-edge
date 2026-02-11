import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CustomResourceConfig } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { CloudFrontCachingStrategy, IContext, OriginAlb, OriginType, SecretFieldNames } from '../context/IContext';
import { AcmCertificate } from './Certificate';
import { ContextLog } from '../context/ContextLog';
import { CloudfrontDistribution } from './Distribution';
import { HttpOriginBase } from './Origin';
import { albExists } from './OriginAlb';
import { IRoute53HostedZone, Route53HostedZone } from './Route53';
import { SecretsManagerSecret } from './secrets/Secret';
import { BU_NameTagAspect, TaggingAspect } from './Tagging';
import { getClone, getStackName, logHeader } from './Util';

/**
 * @param scope - The parent construct (can be App, Stack, or other Construct)
 * @param id - The construct identifier
 * @param context - The Shibboleth configuration context
 */
export type ShibbolethAtEdgeConstructProps = {
  scope: Construct,
  id: string,
  context: IContext,
  httpOriginBase?: HttpOriginBase
};

type ShibbolethAtEdgeConstructPropsInternal = ShibbolethAtEdgeConstructProps & {
  hostedZone: IRoute53HostedZone
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
    const { context: processedContext, hostedZone } = await ShibbolethAtEdgeConstruct.performAsyncValidation(props.context);
    
    // Create and return the construct with the processed context
    return new ShibbolethAtEdgeConstruct({
      ...props,
      context: processedContext,
      hostedZone} satisfies ShibbolethAtEdgeConstructPropsInternal);
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
    const { context: processedContext, hostedZone } = await ShibbolethAtEdgeConstruct.performAsyncValidation(context);
    
    const { ACCOUNT: account, REGION: region, TAGS: { 
      Landscape, Function, Service, CostCenter='', Ticket='' 
    } } = processedContext;

    const stackName = getStackName(processedContext);
    
    const stack = new Stack(scope, stackName, {
      stackName,
      description: `Lambda-based shibboleth service provider - Context configuration stored in S3`,
      env: { account, region },
      tags: { Service, Function, Landscape, CostCenter, Ticket },
    });
    
    // Create the construct within the stack
    new ShibbolethAtEdgeConstruct({
      ...props,
      scope: stack,
      context: processedContext,
      hostedZone} satisfies ShibbolethAtEdgeConstructPropsInternal);
    
    return stack;
  }

  /**
   * Private constructor - use getInstance() or createStack() instead
   */
  constructor(private props: ShibbolethAtEdgeConstructPropsInternal) {
    const { scope, id, context, hostedZone } = props;
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

      // Determine if this code is running from an installed package
      const isInstalled = __dirname.includes('node_modules');

      if( ! isInstalled ) {
        // Apply standard tags to all resources
        const { TAGS: { Landscape, Function, Service, CostCenter='', Ticket='' } } = context;
        const standardTags = { Service, Function, Landscape, CostCenter, Ticket };
        new TaggingAspect(construct, standardTags).applyTags({ 
          aspect: new BU_NameTagAspect(standardTags) 
        });
      }
    }

    // Set context for the construct
    this.node.setContext('stack-parms', context);

    // Create the CloudFront distribution (context is already validated)
    const distributionId = scope.node.id.endsWith('Stack') ? scope.node.id : 'distribution';
    this._cloudfrontDistribution = new CloudfrontDistribution(this, distributionId, {
      ignoreRoute53: ShibbolethAtEdgeConstruct.ignoreRoute53,
      httpOriginBase: this.props.httpOriginBase,
      context,
      hostedZone
    });
    
    // Store the context configuration using ContextLog (S3 storage)
    // NOTE: If you want to change the id of this construct or name of the bucket, you must first
    // redeploy with this code commented out (to remove it), then uncomment and redeploy again 
    // to avoid cloudformation errors.
    new ContextLog(this, 'context', { context, stackName:getStackName(context) });
  }  


  /**
   * Performs all async validation and setup operations before construct creation
   */
  private static async performAsyncValidation(contextInput: IContext): Promise<{context:IContext, hostedZone: Route53HostedZone}> {
    const hostedZone: Route53HostedZone = new Route53HostedZone(contextInput);

    // Validate usage of ALB vs Function URL.
    let context = 
    await ShibbolethAtEdgeConstruct.validateAlb(contextInput);

    // Validate potential A record conflicts in Route53. 
    await ShibbolethAtEdgeConstruct.validateARecord(hostedZone);
    
    // Validate secret exists
    await ShibbolethAtEdgeConstruct.validateSecret(context);

    // Validate certificate exists if specified
    await ShibbolethAtEdgeConstruct.validateCertificate(context);
    
    return { context, hostedZone };
  }

  /**
   * Validate the ALB exists if specified, and switch to Function URL if not. This allows the 
   * stack to be deployed even if the ALB is not yet available, which can be the case if the 
   * ALB is created in a separate stack that has not been deployed yet.
   * @param contextInput 
   * @returns 
   */
  private static async validateAlb(contextInput: IContext): Promise<IContext> {
    // Get an object that can be mutated.
    let context = getClone<IContext>(contextInput);

    const { REGION: region, ORIGIN, } = context;
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

    return context;
  }

  /**
   * Find out if an A record for the subdomain already exists AND was not created by this stack.
   * @param context 
   */
  private static async validateARecord(route53HostedZone: Route53HostedZone): Promise<void> {
    const { REGION: region, ORIGIN: { subdomain } = {}, DNS: { hostedZone } = {}
    } = route53HostedZone.context;

    if( subdomain && hostedZone ) {
      const record = await route53HostedZone.findARecord(subdomain);
      const { createdByThisStack, hostedZoneId, recordSet} = record ?? {};
      if(recordSet && ! createdByThisStack) {
        ShibbolethAtEdgeConstruct.ignoreRoute53 = true;
      }
    }
  }

  /**
   * Validates that the required Secrets Manager secret exists
   */
  private static async validateSecret(context: IContext): Promise<void> {
    const { SHIBBOLETH: { secret: { secretArn } = {} } = {}, REGION: region } = context;
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

  private static async validateCertificate(context: IContext): Promise<void> {
    let failures = 0;
    const cert = new AcmCertificate(context);
    const { DNS: { certificateARN, hostedZone } = {} } = context;

    // First check the non-async validations that can be performed just based on the ARN format and context values. 
    // This way we can provide more complete feedback to the user in one go instead of failing on the first check and making them fix things iteratively.
    failures += cert.isValidArn ? 0 : 1;
    failures += cert.isInThisAccount ? 0 : 1;
    failures += cert.isInUsEast1 ? 0 : 1;
    
    if( failures > 0 ) {
      logHeader('CERTIFICATE VALIDATION ERROR!!!');
      console.error(`The provided certificate ARN ${certificateARN} did not pass validation for use with this construct. ` +
        `\nPlease review the following messages for details:\n${cert.messages}`);
      process.exit(1);
    }

    if( !await cert.exists() ) {
      logHeader('CERTIFICATE VALIDATION ERROR!!!');
      console.error(`The certificate with ARN ${certificateARN} does not exist. ` +
        `\nPlease ensure the certificate exists and is valid, and that the ARN is correct. Validation messages: \n${cert.messages}`);
      process.exit(1);
    }

    if( ! await cert.reflectsHostedZoneDomain() ) {
      logHeader('CERTIFICATE VALIDATION WARNING!!!');
      console.warn(`The certificate with ARN ${certificateARN} does not appear to reflect the hosted zone domain ${hostedZone}. ` +
        `\nThis may cause issues when creating the CloudFront distribution. Validation messages: \n${cert.messages}`);
    }

    console.log(cert.messages);
  }

  public get cloudfrontDistribution(): CloudfrontDistribution {
    return this._cloudfrontDistribution;
  }
}
