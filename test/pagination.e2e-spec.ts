import { Controller, Get, INestApplication, Query } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import {
  PAGINATION_MAX_PAGE_SIZE,
  paginate,
  paginationQuerySchema,
  setupHttpHandling,
  ZodValidationPipe,
} from '../src/common/http';
import type { PaginationQuery } from '../src/common/http';

const ITEMS = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}` }));

@Controller('api/v1/__page-probe')
class PageProbeController {
  @Get()
  list(
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): unknown {
    return paginate(ITEMS, query);
  }
}

async function buildApp(): Promise<INestApplication<App>> {
  const fixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [PageProbeController],
  }).compile();
  const app = fixture.createNestApplication({ bodyParser: false });
  setupHttpHandling(app, { requestBodyLimit: '1mb' });
  await app.init();
  return app;
}

describe('API versioning and pagination (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns the default paged envelope', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/__page-probe')
      .expect(200);
    const body = res.body as {
      page: { page: number; pageSize: number; total: number };
      data: unknown[];
    };
    expect(body.page).toEqual({ page: 1, pageSize: 20, total: 7 });
    expect(body.data.length).toBe(7);
  });

  it('slices deterministically by page', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/__page-probe?page=2&pageSize=3')
      .expect(200);
    const body = res.body as {
      page: { page: number; pageSize: number; total: number };
      data: unknown;
    };
    expect(body.page).toEqual({ page: 2, pageSize: 3, total: 7 });
    expect(body.data).toEqual([{ id: 'i3' }, { id: 'i4' }, { id: 'i5' }]);
  });

  it('rejects out-of-range params with validation_failed', async () => {
    const bad = await request(app.getHttpServer())
      .get('/api/v1/__page-probe?page=0')
      .expect(400);
    expect((bad.body as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
    const over = await request(app.getHttpServer())
      .get(`/api/v1/__page-probe?pageSize=${PAGINATION_MAX_PAGE_SIZE + 1}`)
      .expect(400);
    expect((over.body as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
  });
});
