import { HttpOrigin, HttpOriginProps } from "aws-cdk-lib/aws-cloudfront-origins";
import { OriginAlb } from "../context/IContext";
import { OriginProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { 
  ElasticLoadBalancingV2Client, 
  DescribeLoadBalancersCommand,
  LoadBalancer 
} from "@aws-sdk/client-elastic-load-balancing-v2";

/**
 * Create an origin to add to the cloudfront distribution that targets a pre-existing application load balancer.
 */
export const getAlbOrigin = (origin:OriginAlb) => {
  const { appAuthorization=true, dnsName, httpsPort } = origin;
  // const alb = ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(
  //   this.cloudFrontDistribution,
  //   `origin-alb`,
  //   {
  //     loadBalancerArn: '',
  //     securityGroupId: '',
  //     loadBalancerDnsName: dnsName
  //   } as ApplicationLoadBalancerAttributes
  // ) as ApplicationLoadBalancer;

  // const albOrigin = new LoadBalancerV2Origin(alb, {
  //   httpsPort,
  //   customHeaders: { [headerName]: headerValue } as Record<string, string>,      
  // } as LoadBalancerV2OriginProps);

  return new HttpOrigin(dnsName, {
    protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
    httpsPort,
    originPath: '/',
    customHeaders: {
      APP_AUTHORIZATION: `${appAuthorization}`,
      // CLOUDFRONT_CHALLENGE_HEADER_NAME could be set here.
    }       
  } as HttpOriginProps);
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
