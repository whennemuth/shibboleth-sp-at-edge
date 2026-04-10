import { KeyValueStore } from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
import { IContext } from '../../context/IContext';
import { getStackName } from '../util';

/**
 * Creates a CloudFront KeyValueStore for routing decisions.
 * 
 * The KVS stores routing rules in a type-prefixed format:
 * - Keys: URL paths (e.g., "/admissions", "/cas/biology")
 * - Values: Type-prefixed strings (e.g., "C:alb-domain", "R:301:https://...")
 * 
 * Type prefixes:
 * - C: Cluster routing (WordPress ALB domain)
 * - R: Redirect (status code + target URL)
 * - S: Static S3 origin
 * - P: PHP application origin
 * 
 * The KVS starts empty and must be populated via AWS SDK UpdateKeys API.
 * See AGENT_STRATEGY.md for complete schema documentation.
 */
export class RoutingKeyValueStore extends Construct {
  public readonly store: KeyValueStore;

  constructor(scope: Construct, id: string, context: IContext) {
    super(scope, id);

    const kvsName = context.ROUTING?.kvsName
      ?? `bu-routing-kvs-${context.TAGS.Landscape}`;

    this.store = new KeyValueStore(this, 'RoutingKvs', {
      keyValueStoreName: kvsName,
      comment: `Routing table for ${context.TAGS.Landscape} CloudFront distribution`,
      // KVS starts empty - population is via AWS SDK UpdateKeys API (manual workflow)
      // See: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html
    });
  }
}
