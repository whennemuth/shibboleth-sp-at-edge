import { Duration, Fn } from "aws-cdk-lib";
import { OriginProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, HttpOriginProps } from "aws-cdk-lib/aws-cloudfront-origins";
import { FunctionUrl, FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { IContext, OriginFunctionUrl } from "../context/IContext";

export type OriginFunctionUrlConfig = {
  origin:OriginFunctionUrl,
  stack: Construct, 
  context: IContext, 
  edgeFunctionForOriginRequest:NodejsFunction|undefined
}

export const getFunctionUrlOrigin = (config:OriginFunctionUrlConfig):HttpOrigin  => {
  const { origin } = config;
  if(origin.url) {
    throw new Error('Existing function url as origin not implemented yet.');
  }
  return getDummyLambdaAppOrigin(config);
}

/**
 * Create an origin to add to the cloudfront distribution that targets a "dummy" target application
 * comprised of a single lambda function with a function url to address it by.
 */
const getDummyLambdaAppOrigin = (config:OriginFunctionUrlConfig):HttpOrigin => {
  const { stack, context } = config;
  const { APP_LOGIN_HEADER, APP_LOGOUT_HEADER, ORIGIN, STACK_ID, TAGS: { Landscape } } = context;
  const { appAuthorization=true } = ORIGIN || {};

  // Simple lambda-based web app
  const appFunction = new NodejsFunction(stack, 'AppFunction', {
    runtime: Runtime.NODEJS_18_X,
    entry: 'lib/lambda/FunctionApp.ts',
    timeout: Duration.seconds(10),
    functionName: `${STACK_ID}-${Landscape}-app-function`,
    environment: { 
      APP_AUTHORIZATION: `${appAuthorization}`,
      APP_LOGIN_HEADER, 
      APP_LOGOUT_HEADER
    }
  });

  // Lambda function url for the web app.
  const appFuncUrl = new FunctionUrl(appFunction, 'Url', {
    function: appFunction,
    // authType: FunctionUrlAuthType.AWS_IAM,
    authType: FunctionUrlAuthType.NONE,      
  });

  /**
   * This split function should take a function url like this:
   *    https://dg4qdeehraanv7q33ljsrfztae0fwyvz.lambda-url.us-east-2.on.aws/
   * and extract its domain like this:
   *    dg4qdeehraanv7q33ljsrfztae0fwyvz.lambda-url.us-east-2.on.aws
   * 'https://' is removed (Note: trailing '/' is also removed)
   */
  const funcUrlOrigin = new HttpOrigin(Fn.select(2, Fn.split('/', appFuncUrl.url)), {
    protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
    httpsPort: 443,
    customHeaders: {
      APP_AUTHORIZATION: `${appAuthorization}`
    }       
  } as HttpOriginProps);

  return funcUrlOrigin;
}