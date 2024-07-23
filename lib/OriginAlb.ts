import { HttpOrigin, HttpOriginProps } from "aws-cdk-lib/aws-cloudfront-origins";
import { OriginAlb } from "../context/IContext";
import { OriginProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";

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
      // CLOUDFRONT_CHALLENGE_HEADER could be set here.
    }       
  } as HttpOriginProps);
}
