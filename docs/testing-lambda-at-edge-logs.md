## Where are the Lambda@Edge cloudwatch logs?

Provided the account is [enabled to push logs to cloudwatch](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-testing-debugging.html#lambda-edge-testing-debugging-cloudwatch-logs-enabled), edge lambda activity will be pushed to a cloudwatch log group, where the name of the log group will be:

```
/aws/lambda/[region].[function name]
```

where "region" refers to the aws region where the lambda function itself exists, and "function name" is the name of the lambda function.

The link above states the following:

> ***Check to see if the logs appear in CloudWatch.** Make sure that you look in the Region where the Lambda@Edge function executed. For more information, see [Determining the Lambda@Edge Region](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-testing-debugging.html#lambda-edge-testing-debugging-determine-region).*

What this means is that multiple instances of this log group may exist across separate regions as reflected by which edge locations the function was distributed to per the [distribution pricing class](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PriceClass.html).

To see the dispersal of this log group, a helper script has been provided:

```
cd bin/
sh findlogs.sh SPFunctionOrigin
```

The output will look like this:

```
eu-central-1 /aws/lambda/us-east-1.SPFunctionOrigin
us-east-1 /aws/lambda/us-east-1.SPFunctionOrigin
us-east-2 /aws/lambda/us-east-1.SPFunctionOrigin
```

When testing, if you need to know which log group the most recent request you sent through cloudwatch was logged to for the edge lambda output, [look at the metrics for the function on the cloudfront console](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-testing-debugging.html#lambda-edge-testing-debugging-determine-region):

1. Go to: [Cloudwatch monitoring](https://us-east-1.console.aws.amazon.com/cloudfront/v4/home?region=eu-central-1#/monitoring)
2. Click the `"Lambda@Edge"` tab
3. Click the `"View Metrics"` button

Invocations are graphed over time and color-coded by region, and your request will show up as the most recent data point.

Alternatively, you could have a browser tab open for each region and simply monitor the log group in each tab for the appearance of a new log stream, or new output to an existing log stream.