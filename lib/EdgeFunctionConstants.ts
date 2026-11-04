/**
 * Constants for Edge function names, extracted to avoid circular dependencies
 * and to allow scripts to import these values without loading the full CDK stack.
 */

export const EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME = 'SPFunctionOriginRequest';
export const EDGE_REQUEST_VIEWER_FUNCTION_BASENAME = 'SPFunctionViewerRequest';
export const EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME = 'SPFunctionViewerResponse';

export const EDGE_FUNCTION_BASENAMES = [
  EDGE_REQUEST_VIEWER_FUNCTION_BASENAME,
  EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME,
  EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME
] as const;

/**
 * The name of one of a landscape's Lambda@Edge functions, e.g. "shibsp-dev-SPFunctionViewerRequest".
 */
export const edgeFunctionName = (stackId: string, landscape: string, basename: string): string =>
  `${stackId}-${landscape}-${basename}`;

/**
 * The comment on a landscape's CloudFront distribution: the only way the cleanup utilities can find it.
 */
export const distributionComment = (landscape: string): string => `shib-lambda-${landscape}-distribution`;
