import {
  DescribeLoadBalancersCommand,
  ElasticLoadBalancingV2Client
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { OriginProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, HttpOriginProps, LoadBalancerV2Origin, LoadBalancerV2OriginProps } from "aws-cdk-lib/aws-cloudfront-origins";
import { ApplicationLoadBalancer, ApplicationLoadBalancerAttributes } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";
import { OriginAlb, OriginType } from "../context/IContext";
import { HttpOriginBase } from "./Origin";
import { APP_AUTHORIZATION_HEADER_NAME } from "shibboleth-sp";

export type AlbParms = {
  scope:Construct,
  loadBalancerArn:string,
  securityGroupId:string,
  customHeaders?: { key: string, value: string }[]
}

/**
 * Create an origin to add to the cloudfront distribution that targets a pre-existing application load balancer.
 */
export const getAlbOrigin = (origin:OriginAlb, albParms?: AlbParms): HttpOriginBase => {
  return { httpOrigin: albParms ? 
    getLoadBalancerV2Origin(origin, albParms) : 
    getHttpOrigin(origin),
    originType: OriginType.ALB
  };
}

/**
 * Creates an HttpOrigin for an Application Load Balancer - the simple, practical approach.
 * 
 * This treats the ALB as a generic HTTPS endpoint, which is functionally equivalent to
 * using LoadBalancerV2Origin but with much less complexity. Since ALBs are just HTTPS
 * endpoints from CloudFront's perspective, this approach provides the same functionality
 * without requiring additional AWS resource lookups (ARN, security groups).
 * 
 * @param origin ALB configuration containing DNS name, port, and authorization settings
 * @returns HttpOrigin configured for the ALB endpoint
 */
const getHttpOrigin = (origin:OriginAlb): HttpOrigin => {
  const { appAuthorization=true, dnsName, httpsPort } = origin;
  return new HttpOrigin(dnsName, {
    protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
    httpsPort,
    originPath: '/',
    customHeaders: {
      [APP_AUTHORIZATION_HEADER_NAME]: `${appAuthorization}`,
      // CLOUDFRONT_CHALLENGE_HEADER_NAME could be set here.
    }       
  } as HttpOriginProps);
}

/**
 * Creates a LoadBalancerV2Origin - the "proper" CDK way to handle ALB origins.
 * 
 * NOTE: This function will likely never be used in practice due to complexity:
 * 1. Requires loadBalancerArn - not readily available without additional AWS API calls
 * 2. Requires securityGroupId - also requires additional lookups
 * 3. Additional setup complexity compared to the simpler HttpOrigin approach
 * 4. The HttpOrigin approach achieves the same functional result since ALBs are
 *    just HTTPS endpoints from CloudFront's perspective
 * 
 * This implementation is kept for completeness and potential future use cases
 * where the caller has all required ALB attributes readily available.
 * 
 * @param origin 
 * @param albParms 
 * @returns 
 */
const getLoadBalancerV2Origin = (origin:OriginAlb, albParms: AlbParms): LoadBalancerV2Origin => {
  const { appAuthorization=true, dnsName, httpsPort } = origin;
  let { scope, loadBalancerArn, securityGroupId, customHeaders=[] } = albParms;

  const alb = ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
    scope,
    `origin-alb`,
    {
      loadBalancerArn,
      securityGroupId,
      loadBalancerDnsName: dnsName
    } as ApplicationLoadBalancerAttributes
  ) as ApplicationLoadBalancer;

  if( ! customHeaders.find(h => h.key == APP_AUTHORIZATION_HEADER_NAME) ) {
    customHeaders.push({ key: APP_AUTHORIZATION_HEADER_NAME, value: `${appAuthorization}` });
  }

  return new LoadBalancerV2Origin(alb, {
    httpsPort,
    customHeaders: customHeaders?.reduce((acc, header) => {
      acc[header.key] = header.value;
      return acc;
    }, {} as Record<string, string>),
  } as LoadBalancerV2OriginProps);
}

/**
 * Determine whether an ALB with the specified DNS name exists.
 * @param dnsName The DNS name of the ALB to check.
 * @returns 
 */
export const albExists = async ({ dnsName, region }: { dnsName: string|undefined, region: string }): Promise<boolean> => {
  try {
    if(!dnsName) {
      return false;
    }
    const client = new ElasticLoadBalancingV2Client({ region });
    
    // Get all load balancers and filter by DNS name
    const command = new DescribeLoadBalancersCommand({});
    const response = await client.send(command);
    
    if (!response.LoadBalancers) {
      return false;
    }
    
    // Find ALB/ELB with matching DNS name
    const matchingAlb = response.LoadBalancers.find(
      (lb) => lb.DNSName === dnsName // && lb.Type === 'application'
    );
    
    if(matchingAlb) {
      return true;
    }
    return false;
  } 
  catch (error) {
    console.error('Error checking ALB existence:', error);
    throw error;
  }
}
