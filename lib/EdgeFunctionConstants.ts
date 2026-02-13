/**
 * Constants for Edge function names, extracted to avoid circular dependencies
 * and to allow scripts to import these values without loading the full CDK stack.
 */

export const EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME = 'SPFunctionOriginRequest';
export const EDGE_REQUEST_VIEWER_FUNCTION_BASENAME = 'SPFunctionViewerRequest';
export const EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME = 'SPFunctionViewerResponse';
