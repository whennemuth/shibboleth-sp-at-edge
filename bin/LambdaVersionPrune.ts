/**
 * npm run prune [dryrun]: delete the superseded Lambda@Edge function versions of the landscape in
 * ./context/context.json, leaving the distribution and the versions it uses alone (see lib/EdgeVersionPruning.ts).
 * Safe to run at any time; a version CloudFront still has replicas of is left for a later run.
 */
import { IContext } from '../context/IContext';
import * as ctx from '../context/context.json';
import { pruneEdgeLambdaVersions } from '../lib/EdgeVersionPruning';

const { STACK_ID, TAGS: { Landscape } } = ctx as IContext;

if(module === require.main) {
  const dryrun = process.argv[2] === 'dryrun';
  pruneEdgeLambdaVersions({ stackId: STACK_ID, landscape: Landscape, dryrun }).then(({ deleted, kept, deferred, failed }) => {
    console.log(`${dryrun ? 'Would delete' : 'Deleted'} ${deleted.length}, kept ${kept.length}, deferred ${deferred.length}, failed ${failed.length}.`);
    if(failed.length) process.exitCode = 1;
  }).catch(e => {
    console.error(e);
    process.exitCode = 1;
  });
}
