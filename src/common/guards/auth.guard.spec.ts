import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, AuthenticatedUser } from './auth.guard';

describe('AuthGuard', () => {
  let guard: AuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthGuard],
    }).compile();

    guard = module.get<AuthGuard>(AuthGuard);
  });

  describe('canActivate', () => {
    it('should allow valid employee token', () => {
      const mockRequest: any = {
        headers: { authorization: 'Bearer emp-1' },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user.id).toBe('1');
      expect(mockRequest.user.type).toBe('employee');
    });

    it('should allow valid manager token', () => {
      const mockRequest: any = {
        headers: { authorization: 'Bearer mgr-1' },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockRequest.user.type).toBe('manager');
    });

    it('should allow valid admin token', () => {
      const mockRequest: any = {
        headers: { authorization: 'Bearer admin-1' },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockRequest.user.type).toBe('admin');
    });

    it('should reject missing authorization header', () => {
      const mockRequest = {
        headers: {},
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        UnauthorizedException,
      );
    });

    it('should reject empty bearer token', () => {
      const mockRequest = {
        headers: { authorization: 'Bearer ' },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        UnauthorizedException,
      );
    });

    it('should reject invalid token format', () => {
      const mockRequest = {
        headers: { authorization: 'Bearer invalid' },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        UnauthorizedException,
      );
    });

    it('should reject invalid token type', () => {
      const mockRequest = {
        headers: { authorization: 'Bearer unknown-1' },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        UnauthorizedException,
      );
    });

    it('should extract complex user IDs with hyphens', () => {
      const mockRequest: any = {
        headers: { authorization: 'Bearer emp-user-123-abc' },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
      expect(mockRequest.user.id).toBe('user-123-abc');
    });

    it('should set token on user object', () => {
      const mockRequest: any = {
        headers: { authorization: 'Bearer emp-1' },
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      guard.canActivate(mockContext);

      expect(mockRequest.user.token).toBe('emp-1');
    });
  });
});
