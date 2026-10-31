import { TwitchAuth } from '../src/twitchAuth.js';
import { TwitchEventSub } from '../src/twitchEventSub.js';

const auth = new TwitchAuth();
let eventSub;

try {
  const identity = await auth.validate();
  console.log(`Validated Twitch account: ${identity.login} (${identity.user_id})`);
  console.log(`Scopes: ${identity.scopes.join(' ')}`);
  console.log(`Token expires in: ${identity.expires_in} seconds`);

  eventSub = new TwitchEventSub({ auth, dryRunSend: true });
  const connected = await eventSub.connect();
  console.log(`EventSub subscription: ${connected.subscription?.id || '(no id returned)'}`);
  console.log(`EventSub status: ${connected.subscription?.status || 'active'}`);
  const listed = await auth.helix('eventsub/subscriptions');
  const createdIds = eventSub.subscriptionIds || new Set();
  for (const subscription of listed.data || []) {
    if (!createdIds.has(subscription.id)) continue;
    console.log(`Listed ${subscription.type}: ${subscription.status}`);
    await auth.helix('eventsub/subscriptions', {
      method: 'DELETE', query: { id: subscription.id },
    });
    console.log(`Deleted ${subscription.type} subscription`);
  }
} catch (error) {
  console.error(`Twitch live check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await eventSub?.stop();
}
