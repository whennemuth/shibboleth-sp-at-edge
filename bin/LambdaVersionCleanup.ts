import { CloudFrontClient, DistributionSummary, GetDistributionCommand, GetDistributionCommandOutput, ListDistributionsCommand, ListDistributionsResult, UpdateDistributionCommand, } from "@aws-sdk/client-cloudfront";
import { DeleteFunctionCommand, LambdaClient, ListVersionsByFunctionCommand, ListVersionsByFunctionCommandOutput } from "@aws-sdk/client-lambda";
import { IContext } from '../context/IContext';
import * as ctx from '../context/context.json';

const context = ctx as IContext;
const client = new LambdaClient();
const cloudFrontClient = new CloudFrontClient();
const { STACK_ID, REGION, TAGS: { Landscape }, EDGE_REQUEST_ORIGIN_FUNCTION_NAME, EDGE_RESPONSE_VIEWER_FUNCTION_NAME } = context;
process.env.AWS_REGION = REGION;
let dryrun:string;

if(process.argv.length > 2 && process.argv[2] === 'dryrun') {
  dryrun = 'true';
}

/**
 * This class represents a cloudfront distribution with functionality to remove all of its lambda@edge function associations.
 */
export class Distribution {
  private landscape:string

  constructor(landscape:string) {
    this.landscape = landscape;
  }

  /**
   * Remove the lambda@edge function associations from the cloudfront distribution
   */
  public disassociateFromCloudfrontDistribution = async () => {

    // 1) Lookup the distribution ID
    console.log('Listing distributions...');
    const listCommand = new ListDistributionsCommand({ });
    const response = await cloudFrontClient.send(listCommand) as ListDistributionsResult;
    const distributions = response.DistributionList?.Items?.filter((ds:DistributionSummary) => {
      return ds.Comment && ds.Comment == `shib-lambda-${this.landscape}-distribution`;
    }) as DistributionSummary[];
    if(distributions!.length == 0) {
      console.log('No such distribution, looks like it has already been deleted');
      return;
    }
    const Id = distributions[0]!.Id;

    // 2) Use the ID to Get the full distribution
    console.log(`Looking up distribution ${Id}`);
    const getCommand = new GetDistributionCommand({ Id });
    const output = await cloudFrontClient.send(getCommand) as GetDistributionCommandOutput;
    const DistributionConfig = output.Distribution?.DistributionConfig;
    if( ! DistributionConfig?.DefaultCacheBehavior || ! output.ETag) {
      throw new Error('Distribution config lookup failure!')
    }

    // 3) Modify the distribution to remove the edge lambda(s)
    console.log(`Removing lambda@edge function associations from distribution: ${Id}`);
    DistributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations = {
      Quantity: 0,
      Items: []
    };
    const updateCommand = new UpdateDistributionCommand({ Id, DistributionConfig, IfMatch: output.ETag });
    await cloudFrontClient.send(updateCommand);
  }
}

/**
 * This class represents a lambda@edge function.
 * Attempts to simply remove such lambda functions during a stack teardown will fail as explained in the following 
 * developer guide doc:
 * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-delete-replicas.html
 *   1) This class provides the functionality to "remove the function association from the last distribution"
 *   2) Delete prior versions
 * Only when 1) and 2) are performed can the edge function itself be deleted.
 */
export class Lambda {
  private name:string;
  private versions:any[] = [];

  constructor(name:string) {
    this.name = name;
  }

  private loadVersions = async () => {
    if(this.versions.length == 0) {
      const command = new ListVersionsByFunctionCommand({ FunctionName: this.name });
      try {
        const output:ListVersionsByFunctionCommandOutput = await client.send(command);
        output.Versions?.forEach(version => {
          this.versions.push(getVersion(version.FunctionArn))
        })
      }
      catch(e:any) {
        if(e.name && e.name == 'ResourceNotFoundException') {
          console.log(`No such function ${this.name}`);
        }
        else {
          throw(e);
        }
      }
    }
  }

  /**
   * Delete all prior versions of the lambda@edge function
   */
  public dumpPriorVersions = async () => {
    await this.loadVersions();
    console.log('------------------------------------------------');
    console.log(`    Deleting versions for: ${this.name}`)
    console.log('------------------------------------------------');
    this.versions.forEach(async version => {
      if(version.isPriorVersion()) {
        version.delete();
      }
      else {
        console.log(`Leaving the latest version alone: ${version.version()}`)
      }
    })
  }
}

/**
 * @param ms The number of milliseconds to sleep for
 * @returns 
 */
const sleep = (ms:number) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns an object representing a lambda function of a prior version built from a specified arn.
 * @param arn 
 * @returns 
 */
const getVersion = (arn:string|undefined) => {
  const getArnPart = (fromRight:number) => {
    const parts:string[] = (arn||'').split(':');
    return parts[parts.length - fromRight];
  }
  const getVersion = () => getArnPart(1); 
  const getName = () => getArnPart(2); 
  return {
    asString: () => { return arn; },
    isPriorVersion: () => { return /\d+/.test(getVersion()); },
    version: () => { return getVersion(); },
    delete: async () => {
      const input = { 
        FunctionName: getName(),
        Qualifier: getVersion()
      };
      const command = new DeleteFunctionCommand(input);
      if(dryrun) {
        console.log(`Dryrun delete: ${JSON.stringify(input)}`);
      }
      else {
        console.log(`deleting ${JSON.stringify(input)}`);
        const response = await client.send(command);
        await sleep(300); // Slow it down to avoid TooManyRequestsException: Rate exceeded exception
      }
    }
  }
};

/**
 * Delete all versions for all lambda functions
 */
const deleteVersions = async (functionList:string) => {

  // 1) "Orphan" every lambda@edge function from the cloudfront distribution.
  await (new Distribution(Landscape)).disassociateFromCloudfrontDistribution();

  // 2) Get an array of all the lambda functions to process (from env as comma-delimited list)
  const functionArray:string[] = [];
  if(functionList) {
    functionArray.push(...functionList.split(/\x20*,\x20*/));
  }

  // 3) Delete all prior versions of every lambda@edge function (leaving only current version).
  if(functionArray.length > 0) {
    for(var i=0; i<functionArray.length; i++) {
      var lambda = new Lambda(functionArray[i]);
      await lambda.dumpPriorVersions();
    }
  }
  else {
    console.log('FUNCTION_NAMES is missing!');
  }
}

deleteVersions(
 `${EDGE_REQUEST_ORIGIN_FUNCTION_NAME}, \
  ${EDGE_RESPONSE_VIEWER_FUNCTION_NAME}, \
  ${STACK_ID}-${Landscape}-app-function`
).then(() => {
  console.log('Completed. Wait an hour or two for cloudfront to delete its replicas before deleting the stack.');
}).catch(e => {
  console.log(JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
});
