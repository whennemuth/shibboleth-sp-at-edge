// Core construct exports for reusability
export { 
  ShibbolethAtEdgeConstruct
} from '../../lib/ShibbolethAtEdgeConstruct';

// Context and configuration types
export { 
  type IContext,
  CloudFrontCachingStrategy,
  OriginType,
  type OriginAlb,
  type OriginFunctionUrl,
  type SecretFieldNames 
} from '../../context/IContext';

// Utility functions that might be useful for consumers
export { getStackName } from '../../lib/Util';

// Secrets management class
export { SecretsManager } from '../../lib/secrets/SecretsManager';

// Secret types and classes
export { SecretsManagerSecret } from '../../lib/secrets/Secret';
export type { SecretsManagerSecretParms } from '../../lib/secrets/Secret';

// Tagging utilities
export { BU_NameTagAspect, TaggingAspect } from '../../lib/Tagging';

// Edge function basenames for reference
export { EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME } from '../../lib/EdgeFunctionOriginRequest';
export { EDGE_REQUEST_VIEWER_FUNCTION_BASENAME } from '../../lib/EdgeFunctionViewerRequest';
export { EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME } from '../../lib/EdgeFunctionViewerResponse';

// Edge function and distribution naming, for the cleanup utilities
export { EDGE_FUNCTION_BASENAMES, edgeFunctionName, distributionComment } from '../../lib/EdgeFunctionConstants';

// Lambda cleanup utilities: teardown (deleteEdgeLambdaVersions), and pruning superseded versions after a deploy
export { deleteVersions as deleteEdgeLambdaVersions } from '../DistributionToCleanup'
export { pruneEdgeLambdaVersions } from '../../lib/EdgeVersionPruning';
export type { PruneEdgeLambdaVersionsParms, PruneEdgeLambdaVersionsResult, EdgeFunctionVersion } from '../../lib/EdgeVersionPruning';