import {
  Function as CfFunction,
  FunctionCode,
  FunctionRuntime,
  KeyValueStore
} from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
import { IContext } from '../../context/IContext';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Creates a CloudFront Function for URL routing.
 * 
 * The function implements longest-prefix-match routing using the associated KVS:
 * 1. Normalizes the request path (lowercase, trim trailing slashes)
 * 2. Attempts KVS lookups from full path down to progressively shorter prefixes
 * 3. On KVS hit: applies routing rule (redirect or origin selection)
 * 4. On KVS miss: falls through to default origin
 * 
 * The function source is read from `functions/routing-function.js` and the
 * ENABLE_LOGGING flag is dynamically replaced based on context.ROUTING.enableLogging.
 * 
 * Performance budget: ~1ms compute time, max 3 sequential KVS lookups per request.
 */
export class RoutingFunction extends Construct {
  public readonly fn: CfFunction;

  constructor(scope: Construct, id: string, props: {
    kvs: KeyValueStore;
    context: IContext;
  }) {
    super(scope, id);

    // Read the routing function source and inject the logging flag
    const functionPath = path.join(__dirname, '../../functions/routing-function.js');
    let functionCode = fs.readFileSync(functionPath, 'utf8');
    
    // Replace the ENABLE_LOGGING placeholder with actual value from context
    const enableLogging = props.context.ROUTING?.enableLogging ?? false;
    functionCode = functionCode.replace(
      /const ENABLE_LOGGING = false;/,
      `const ENABLE_LOGGING = ${enableLogging};`
    );

    this.fn = new CfFunction(this, 'RoutingFn', {
      functionName: `bu-routing-${props.context.TAGS.Landscape}`,
      runtime: FunctionRuntime.JS_2_0,  // Required for cf.updateRequestOrigin()
      code: FunctionCode.fromInline(functionCode),
      keyValueStore: props.kvs,
      comment: `URL routing for ${props.context.TAGS.Landscape} distribution`,
    });
  }
}
