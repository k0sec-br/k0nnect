export { SecurityGate } from './durable/security-gate';
export { VoiceRoom } from './durable/voice-room';

import { app } from './app';
import { cleanupExpiredData } from './services/cleanup-service';

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    return await app.fetch(request, env, context);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await cleanupExpiredData(env);
  },
} satisfies ExportedHandler<Env>;
