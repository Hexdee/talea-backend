import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the service health payload', () => {
    const controller = new HealthController();
    const result = controller.getHealth();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('lesenpad-backend');
    expect(typeof result.timestamp).toBe('string');
  });
});
