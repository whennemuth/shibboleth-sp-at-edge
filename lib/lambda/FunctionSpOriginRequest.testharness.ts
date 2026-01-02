import * as event from './sample-origin-request-event.json';
import { handler } from './FunctionSpOriginRequest';


handler(event).then((response) => {
  JSON.stringify(response, null, 2);
})