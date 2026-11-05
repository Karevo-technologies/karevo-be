import { AppException } from '../../common/errors/app.exception';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RecordsService } from './records.service';

describe('RecordsService', () => {
  let service: RecordsService;
  let prisma: any;
  let crypto: any;

  const me = { id: 'user-1', sessionId: 'sess-1', ninStatus: 'verified' as const };

  beforeEach(() => {
    prisma = {
      healthRecord: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    crypto = {
      decrypt: jest.fn((val: string) => `decrypted:${val}`),
    };
    service = new RecordsService(prisma as PrismaService, crypto as CryptoService);
  });

  it('lists records scoped to the user and excludes details', async () => {
    prisma.healthRecord.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        type: 'Blood Test',
        category: 'blood',
        issuedBy: { id: 'org-1', name: 'Synlab' },
        issuedDate: new Date('2026-07-14'),
        summary: 'Normal',
        receivedAt: new Date('2026-07-14T11:00:00Z'),
      },
    ]);

    const res = await service.list(me, { limit: 20 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe('rec-1');
    expect(res.data[0].issuedDate).toBe('2026-07-14');
    expect((res.data[0] as any).details).toBeUndefined();
    expect(prisma.healthRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
      }),
    );
  });

  it('gets a single record and decrypts details', async () => {
    prisma.healthRecord.findFirst.mockResolvedValue({
      id: 'rec-1',
      userId: 'user-1',
      type: 'Blood Test',
      category: 'blood',
      issuedBy: { id: 'org-1', name: 'Synlab' },
      issuedDate: new Date('2026-07-14'),
      summary: 'Normal',
      detailsEnc: 'enc-data',
      receivedAt: new Date('2026-07-14T11:00:00Z'),
    });

    const res = await service.get(me, 'rec-1');
    expect(res.id).toBe('rec-1');
    expect(res.details).toBe('decrypted:enc-data');
    expect(crypto.decrypt).toHaveBeenCalledWith('enc-data');
  });

  it('throws notFound if record belongs to someone else or does not exist', async () => {
    prisma.healthRecord.findFirst.mockResolvedValue(null);
    await expect(service.get(me, 'rec-999')).rejects.toThrow(AppException);
  });
});

