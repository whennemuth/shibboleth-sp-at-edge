import { CloudFrontClient, GetDistributionConfigCommand, ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { DeleteFunctionCommand, LambdaClient, ListVersionsByFunctionCommand } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { pruneEdgeLambdaVersions, versionsInUse } from './EdgeVersionPruning';

const cloudFront = mockClient(CloudFrontClient);
const lambda = mockClient(LambdaClient);

const stackId = 'shibsp';
const landscape = 'dev';
const viewerRequest = 'shibsp-dev-SPFunctionViewerRequest';
const originRequest = 'shibsp-dev-SPFunctionOriginRequest';
const viewerResponse = 'shibsp-dev-SPFunctionViewerResponse';
const arn = (name: string, version: string) => `arn:aws:lambda:us-east-1:123456789012:function:${name}:${version}`;
const association = (name: string, version: string) => ({ LambdaFunctionARN: arn(name, version), EventType: 'viewer-request' as const });

const distributionConfig = (defaultAssociations: any[], otherBehaviorAssociations: any[] = []) => ({
  DistributionConfig: {
    DefaultCacheBehavior: { LambdaFunctionAssociations: { Quantity: defaultAssociations.length, Items: defaultAssociations } },
    CacheBehaviors: {
      Quantity: 1,
      Items: [ { PathPattern: '/testing123*', LambdaFunctionAssociations: { Quantity: otherBehaviorAssociations.length, Items: otherBehaviorAssociations } } ]
    }
  } as any
});

const versions = (...numbers: string[]) => ({ Versions: [ '$LATEST', ...numbers ].map(Version => ({ Version })) });

const prune = (dryrun = false) => pruneEdgeLambdaVersions({
  stackId, landscape, dryrun, cloudFrontClient: new CloudFrontClient({}), lambdaClient: new LambdaClient({})
});

describe('pruneEdgeLambdaVersions', () => {

  beforeEach(() => {
    cloudFront.reset();
    lambda.reset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    cloudFront.on(ListDistributionsCommand).resolves({
      DistributionList: { Items: [ { Id: 'EOTHER', Comment: 'shib-lambda-prod-distribution' }, { Id: 'EDEV', Comment: 'shib-lambda-dev-distribution' } ] } as any
    });
    cloudFront.on(GetDistributionConfigCommand, { Id: 'EDEV' }).resolves(distributionConfig([
      association(viewerRequest, '5'), association(originRequest, '3'), association(viewerResponse, '2')
    ]));
    lambda.on(ListVersionsByFunctionCommand, { FunctionName: viewerRequest }).resolves(versions('3', '4', '5'));
    lambda.on(ListVersionsByFunctionCommand, { FunctionName: originRequest }).resolves(versions('1', '2', '3'));
    lambda.on(ListVersionsByFunctionCommand, { FunctionName: viewerResponse }).resolves(versions('2'));
    lambda.on(DeleteFunctionCommand).resolves({});
  });
  afterEach(() => jest.restoreAllMocks());

  const deletedQualifiers = () => lambda.commandCalls(DeleteFunctionCommand).map(c => `${c.args[0].input.FunctionName}:${c.args[0].input.Qualifier}`);

  it('deletes versions older than the one the distribution uses, and keeps the rest', async () => {
    const result = await prune();
    expect(result.distributionId).toBe('EDEV');
    expect(deletedQualifiers()).toEqual([ `${viewerRequest}:3`, `${viewerRequest}:4`, `${originRequest}:1`, `${originRequest}:2` ]);
    expect(result.deleted).toHaveLength(4);
    expect(result.kept).toEqual([
      { functionName: viewerRequest, version: '5' }, { functionName: originRequest, version: '3' }, { functionName: viewerResponse, version: '2' }
    ]);
    expect(cloudFront.commandCalls(GetDistributionConfigCommand)[0].args[0].input).toEqual({ Id: 'EDEV' });
  });

  it('never deletes $LATEST or changes the distribution', async () => {
    await prune();
    expect(deletedQualifiers().some(q => q.endsWith('$LATEST'))).toBe(false);
    expect(cloudFront.calls().map(c => c.args[0].constructor.name)).toEqual([ 'ListDistributionsCommand', 'GetDistributionConfigCommand' ]);
  });

  it('keeps versions newer than the oldest version in use, which may belong to a deploy in progress', async () => {
    lambda.on(ListVersionsByFunctionCommand, { FunctionName: viewerResponse }).resolves(versions('1', '2', '3'));
    const result = await prune();
    expect(deletedQualifiers()).toContain(`${viewerResponse}:1`);
    expect(result.kept).toEqual(expect.arrayContaining([ { functionName: viewerResponse, version: '3' } ]));
  });

  it('counts versions used by any cache behavior as in use', async () => {
    cloudFront.on(GetDistributionConfigCommand, { Id: 'EDEV' }).resolves(distributionConfig(
      [ association(viewerRequest, '5'), association(originRequest, '3'), association(viewerResponse, '2') ],
      [ association(viewerRequest, '4') ]
    ));
    await prune();
    expect(deletedQualifiers()).toEqual([ `${viewerRequest}:3`, `${originRequest}:1`, `${originRequest}:2` ]);
  });

  it('leaves every version of a function the distribution does not use', async () => {
    cloudFront.on(GetDistributionConfigCommand, { Id: 'EDEV' }).resolves(distributionConfig([ association(viewerRequest, '5') ]));
    await prune();
    expect(deletedQualifiers()).toEqual([ `${viewerRequest}:3`, `${viewerRequest}:4` ]);
    expect(lambda.commandCalls(ListVersionsByFunctionCommand).map(c => c.args[0].input.FunctionName)).toEqual([ viewerRequest ]);
  });

  it('defers a version CloudFront still has replicas of, without retrying, and reports other failures', async () => {
    lambda.on(DeleteFunctionCommand, { FunctionName: viewerRequest, Qualifier: '4' }).rejects(Object.assign(
      new Error('Lambda was unable to delete arn:...:4 because it is a replicated function.'), { name: 'InvalidParameterValueException' }
    ));
    lambda.on(DeleteFunctionCommand, { FunctionName: originRequest, Qualifier: '1' }).rejects(Object.assign(
      new Error('not authorized'), { name: 'AccessDeniedException' }
    ));
    const result = await prune();
    expect(result.deferred).toEqual([ { functionName: viewerRequest, version: '4' } ]);
    expect(result.failed).toEqual([ { functionName: originRequest, version: '1', error: 'AccessDeniedException: not authorized' } ]);
    expect(result.deleted).toEqual([ { functionName: viewerRequest, version: '3' }, { functionName: originRequest, version: '2' } ]);
    expect(lambda.commandCalls(DeleteFunctionCommand)).toHaveLength(4);
  });

  it('deletes nothing in a dry run', async () => {
    const result = await prune(true);
    expect(lambda.commandCalls(DeleteFunctionCommand)).toHaveLength(0);
    expect(result.deleted).toHaveLength(4);
  });

  it('does nothing when the landscape has no distribution', async () => {
    cloudFront.on(ListDistributionsCommand).resolves({ DistributionList: { Items: [ { Id: 'EOTHER', Comment: 'shib-lambda-prod-distribution' } ] } as any });
    const result = await prune();
    expect(result).toEqual({ distributionId: undefined, deleted: [], kept: [], deferred: [], failed: [] });
    expect(cloudFront.commandCalls(GetDistributionConfigCommand)).toHaveLength(0);
    expect(lambda.calls()).toHaveLength(0);
  });

  it('finds the distribution on a later page of the distribution list', async () => {
    cloudFront.on(ListDistributionsCommand)
      .resolvesOnce({ DistributionList: { Items: [ { Id: 'EOTHER', Comment: 'other' } ], NextMarker: 'page2', IsTruncated: true } as any })
      .resolvesOnce({ DistributionList: { Items: [ { Id: 'EDEV', Comment: 'shib-lambda-dev-distribution' } ] } as any });
    expect((await prune()).distributionId).toBe('EDEV');
  });

  it('skips a function that does not exist', async () => {
    lambda.on(ListVersionsByFunctionCommand, { FunctionName: viewerRequest }).rejects(Object.assign(new Error('gone'), { name: 'ResourceNotFoundException' }));
    await prune();
    expect(deletedQualifiers()).toEqual([ `${originRequest}:1`, `${originRequest}:2` ]);
  });
});

describe('versionsInUse', () => {
  it('maps qualified association ARNs to function names and versions, ignoring unqualified ones', () => {
    const inUse = versionsInUse(distributionConfig([
      association(viewerRequest, '5'), { LambdaFunctionARN: `arn:aws:lambda:us-east-1:123456789012:function:${originRequest}` }
    ], [ association(viewerRequest, '6') ]).DistributionConfig);
    expect([ ...inUse.entries() ].map(([ name, set ]) => [ name, [ ...set ] ])).toEqual([ [ viewerRequest, [ '5', '6' ] ] ]);
  });
});
