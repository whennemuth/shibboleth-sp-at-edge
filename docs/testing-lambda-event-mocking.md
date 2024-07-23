## Lambda@Edge event object mocking

Part of testing includes mocking for lambda functions. In particular, it is helpful in typescript to have the [event object](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-concepts.html#gettingstarted-concepts-event) mocked.
The AWS article ["Using types for the event object"](https://docs.aws.amazon.com/lambda/latest/dg/typescript-handler.html#event-types) explains how to do this, but here are the relevant steps:

1. [Install the SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)

2. install [quicktype](https://quicktype.io/typescript):

   ```
   npm install -g quicktype
   ```

3. Create a sample event:

   ```
   cd lib/lambda/lib
   sam local generate-event cloudfront simple-remote-call > sp-event.json
   ```

4. Extract a type from the sample event:

   ```
   quicktype sp-event.json -o SimpleRemoteCall.ts
   ```

5. For any lambda entry-point file that expects to process such an event, you can now type the event object passed to the handler:

   ```
   import { SimpleRemoteCall, Request as BasicRequest } from './lib/SimpleRemoteCall';
   ...
   export const handler =  async (event:SimpleRemoteCall) => {
   ```

## 