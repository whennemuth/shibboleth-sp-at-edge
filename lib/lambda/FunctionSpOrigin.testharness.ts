import * as event from './sample-origin-request-event.json';
import { handler } from './FunctionSpOrigin';


handler(event).then((response) => {
  JSON.stringify(response, null, 2);
})