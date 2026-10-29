import { ArgumentsHost } from '@nestjs/common';
import { DomainExceptionFilter } from './domain-exception.filter';
import {
  EmailAlreadyExistsException,
  EmailNotConfirmedException,
  InvalidCredentialsException,
  InvalidTokenException,
  TokenExpiredException,
  TokenReuseDetectedException,
} from '../exceptions/domain.exception';

type ErrorBody = { statusCode: number; error: string; message: unknown };

describe('DomainExceptionFilter', () => {
  let filter: DomainExceptionFilter;
  let mockJson: jest.Mock<void, [ErrorBody]>;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  const sentBody = (): ErrorBody => mockJson.mock.calls[0][0];

  beforeEach(() => {
    filter = new DomainExceptionFilter();
    mockJson = jest.fn<void, [ErrorBody]>();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/test', method: 'POST' }),
      }),
      getArgs: () => [],
      getArgByIndex: () => null,
      switchToRpc: () => ({}),
      switchToWs: () => ({}),
      getType: () => 'http',
    } as unknown as ArgumentsHost;
  });

  it('maps EmailAlreadyExistsException to 409 with EMAIL_ALREADY_EXISTS', () => {
    filter.catch(new EmailAlreadyExistsException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(409);
    expect(mockJson).toHaveBeenCalledWith({
      statusCode: 409,
      error: 'EMAIL_ALREADY_EXISTS',
      message: 'Email is already registered',
    });
  });

  it('maps InvalidCredentialsException to 401 with INVALID_CREDENTIALS', () => {
    filter.catch(new InvalidCredentialsException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(sentBody()).toMatchObject({
      statusCode: 401,
      error: 'INVALID_CREDENTIALS',
    });
    expect(typeof sentBody().message).toBe('string');
  });

  it('maps EmailNotConfirmedException to 403 with EMAIL_NOT_CONFIRMED', () => {
    filter.catch(new EmailNotConfirmedException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(403);
    expect(sentBody()).toMatchObject({
      statusCode: 403,
      error: 'EMAIL_NOT_CONFIRMED',
    });
    expect(typeof sentBody().message).toBe('string');
  });

  it('maps InvalidTokenException to 401 with INVALID_TOKEN', () => {
    filter.catch(new InvalidTokenException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(sentBody()).toMatchObject({
      statusCode: 401,
      error: 'INVALID_TOKEN',
    });
    expect(typeof sentBody().message).toBe('string');
  });

  it('maps TokenExpiredException to 401 with TOKEN_EXPIRED', () => {
    filter.catch(new TokenExpiredException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(sentBody()).toMatchObject({
      statusCode: 401,
      error: 'TOKEN_EXPIRED',
    });
    expect(typeof sentBody().message).toBe('string');
  });

  it('maps TokenReuseDetectedException to 401 with TOKEN_REUSE_DETECTED', () => {
    filter.catch(new TokenReuseDetectedException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(sentBody()).toMatchObject({
      statusCode: 401,
      error: 'TOKEN_REUSE_DETECTED',
    });
    expect(typeof sentBody().message).toBe('string');
  });
});
