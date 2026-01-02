import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins"
import { OriginType } from "../context/IContext"

/**
 * Base type for HTTP origins. 
 */
export type HttpOriginBase = {
  httpOrigin: HttpOrigin,
  originType: OriginType
}