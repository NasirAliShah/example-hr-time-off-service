import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, ROLES_KEY } from './roles.guard';
import { AuthenticatedUser } from './auth.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  describe('canActivate', () => {
    it('should allow access when no roles are required', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(undefined);

      const mockRequest = {
        user: { id: 'emp-1', type: 'employee' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should allow employee access to employee role', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(['employee']);

      const mockRequest = {
        user: { id: 'emp-1', type: 'employee' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should allow manager access to manager role', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(['manager']);

      const mockRequest = {
        user: { id: 'mgr-1', type: 'manager' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should allow admin access to admin role', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(['admin']);

      const mockRequest = {
        user: { id: 'admin-1', type: 'admin' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should deny employee access to manager role', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(['manager']);

      const mockRequest = {
        user: { id: 'emp-1', type: 'employee' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        ForbiddenException,
      );
    });

    it('should deny employee access to admin role', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(['admin']);

      const mockRequest = {
        user: { id: 'emp-1', type: 'employee' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        ForbiddenException,
      );
    });

    it('should deny manager access to admin role', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(['admin']);

      const mockRequest = {
        user: { id: 'mgr-1', type: 'manager' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        ForbiddenException,
      );
    });

    it('should allow access to multiple allowed roles', () => {
      jest
        .spyOn(reflector, 'get')
        .mockReturnValue(['manager', 'admin']);

      const mockRequest = {
        user: { id: 'mgr-1', type: 'manager' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should reject missing user', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(['employee']);

      const mockRequest = {
        user: undefined,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        ForbiddenException,
      );
    });

    it('should include helpful error message with required roles', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(['admin']);

      const mockRequest = {
        user: { id: 'emp-1', type: 'employee' } as AuthenticatedUser,
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      try {
        guard.canActivate(mockContext);
        fail('Should have thrown ForbiddenException');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toContain('admin');
        expect(error.message).toContain('employee');
      }
    });
  });
});
