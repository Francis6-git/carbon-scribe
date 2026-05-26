import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../shared/database/prisma.service';
import { RedisService } from '../cache/redis.service';
import { KafkaService } from '../event-bus/kafka.service';
import { IpfsConfig } from '../ipfs/ipfs.config';
import { SorobanService } from '../stellar/soroban/soroban.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HealthService', () => {
  let service: HealthService;
  let prismaService: jest.Mocked<PrismaService>;
  let redisService: jest.Mocked<RedisService>;
  let kafkaService: jest.Mocked<KafkaService>;
  let ipfsConfig: jest.Mocked<IpfsConfig>;
  let sorobanService: jest.Mocked<SorobanService>;

  const mockRedisClient = {
    ping: jest.fn(),
  };

  const mockRpcClient = {
    getLatestLedger: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue(mockRedisClient),
            isHealthy: jest.fn(),
          },
        },
        {
          provide: KafkaService,
          useValue: {
            isEnabled: jest.fn().mockReturnValue(true),
            getAdmin: jest.fn().mockReturnValue({
              fetchTopicMetadata: jest.fn(),
            }),
          },
        },
        {
          provide: IpfsConfig,
          useValue: {
            jwt: 'mock-jwt',
          },
        },
        {
          provide: SorobanService,
          useValue: {
            getRpcClient: jest.fn().mockReturnValue(mockRpcClient),
          },
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    prismaService = module.get(PrismaService) as any;
    redisService = module.get(RedisService) as any;
    kafkaService = module.get(KafkaService) as any;
    ipfsConfig = module.get(IpfsConfig) as any;
    sorobanService = module.get(SorobanService) as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getReadiness', () => {
    it('should return status healthy if all dependencies are healthy', async () => {
      // Mock DB: success
      prismaService.$queryRaw.mockResolvedValue([1]);

      // Mock Redis: success
      mockRedisClient.ping.mockResolvedValue('PONG');

      // Mock Kafka: success
      kafkaService.getAdmin().fetchTopicMetadata.mockResolvedValue({ topics: [] });

      // Mock IPFS: success
      mockedAxios.get.mockResolvedValue({ status: 200, data: {} });

      // Mock Stellar: success
      mockRpcClient.getLatestLedger.mockResolvedValue({ sequence: 100 });

      const readiness = await service.getReadiness();

      expect(readiness.status).toBe('healthy');
      expect(readiness.checks.database.status).toBe('healthy');
      expect(readiness.checks.redis.status).toBe('healthy');
      expect(readiness.checks.kafka.status).toBe('healthy');
      expect(readiness.checks.ipfs.status).toBe('healthy');
      expect(readiness.checks.stellar.status).toBe('healthy');
    });

    it('should return unhealthy if database check fails', async () => {
      prismaService.$queryRaw.mockRejectedValue(new Error('Connection error'));
      mockRedisClient.ping.mockResolvedValue('PONG');
      kafkaService.getAdmin().fetchTopicMetadata.mockResolvedValue({ topics: [] });
      mockedAxios.get.mockResolvedValue({ status: 200, data: {} });
      mockRpcClient.getLatestLedger.mockResolvedValue({ sequence: 100 });

      const readiness = await service.getReadiness();

      expect(readiness.status).toBe('unhealthy');
      expect(readiness.checks.database.status).toBe('unhealthy');
      expect(readiness.checks.database.error).toBe('Connection error');
    });

    it('should return healthy if Kafka is disabled and all others are healthy', async () => {
      kafkaService.isEnabled.mockReturnValue(false);
      prismaService.$queryRaw.mockResolvedValue([1]);
      mockRedisClient.ping.mockResolvedValue('PONG');
      mockedAxios.get.mockResolvedValue({ status: 200, data: {} });
      mockRpcClient.getLatestLedger.mockResolvedValue({ sequence: 100 });

      const readiness = await service.getReadiness();

      expect(readiness.status).toBe('healthy');
      expect(readiness.checks.kafka.status).toBe('disabled');
    });

    it('should treat IPFS 401/403 status as healthy (reachable)', async () => {
      prismaService.$queryRaw.mockResolvedValue([1]);
      mockRedisClient.ping.mockResolvedValue('PONG');
      kafkaService.getAdmin().fetchTopicMetadata.mockResolvedValue({ topics: [] });
      mockRpcClient.getLatestLedger.mockResolvedValue({ sequence: 100 });

      // Mock IPFS returning a 401 response error
      const error401 = {
        response: { status: 401, data: 'Unauthorized' },
        message: 'Request failed with status code 401',
      };
      mockedAxios.get.mockRejectedValue(error401);

      const readiness = await service.getReadiness();

      expect(readiness.status).toBe('healthy');
      expect(readiness.checks.ipfs.status).toBe('healthy');
      expect(readiness.checks.ipfs.details).toContain('Reachable (HTTP Status: 401)');
    });
  });
});
