import { EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME } from '../lib/EdgeFunctionOriginRequest';
import { EDGE_REQUEST_VIEWER_FUNCTION_BASENAME } from '../lib/EdgeFunctionViewerRequest';
import { EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME } from '../lib/EdgeFunctionViewerResponse';

import { IContext } from '../context/IContext';
import * as ctx from '../context/context.json';
import { deleteVersions } from "./DistributionToCleanup";

const context = ctx as IContext;
const { STACK_ID, REGION, TAGS: { Landscape } } = context;
process.env.AWS_REGION = REGION;

if(module === require.main) {
  deleteVersions(
  `${STACK_ID}-${Landscape}-${EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME}, \
    ${STACK_ID}-${Landscape}-${EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME}, \
    ${STACK_ID}-${Landscape}-${EDGE_REQUEST_VIEWER_FUNCTION_BASENAME}, \
    ${STACK_ID}-${Landscape}-app-function`
  ).then(() => {
    console.log('Completed. You should now be able to delete the stack.');
  }).catch(e => {
    console.log(JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
  });
}
