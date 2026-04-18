# Technical Requirement Document (TRD)
## Time-Off Microservice for ExampleHR

**Document Version:** 1.0  
**Date:** April 2026  
**Status:** Final  
**Author:** Backend Engineering Team

---

## Executive Summary

This document outlines the technical design for a Time-Off Microservice that manages employee leave requests while maintaining synchronization with external HCM systems (Workday/SAP). The core challenge is maintaining balance integrity across two systems where either system can independently update balances, creating race conditions and consistency issues.

The proposed solution uses an **optimistic locking strategy with defensive validation**, **eventual consistency with HCM as source of truth**, and **comprehensive error handling with circuit breaker patterns**. This approach balances user experience (instant feedback) with data integrity (guaranteed correctness).

---

## 1. Problem Statement & Challenges

### 1.1 Core Problem

ExampleHR provides a user-friendly interface for employees to request time off, but the HCM system (Workday/SAP) remains the authoritative source of employment data, including leave balances. The fundamental challenge is keeping these two systems synchronized when:

- **ExampleHR initiates updates**: Employee submits time-off request
- **HCM initiates updates**: Work anniversary bonus, year-start refresh, manual corrections
- **Both systems can fail**: Network issues, validation errors, data corruption
- **Users expect instant feedback**: Employees want immediate confirmation, not eventual consistency

### 1.2 Key Challenges

#### Challenge 1: Bi-Directional Sync Complexity
**Problem**: Two independent systems updating the same data creates race conditions.

**Scenario**:
```
T0: Employee has 10 days balance in both systems
T1: Employee requests 2 days on ExampleHR
    - ExampleHR reserves 2 days locally (8 remaining)
    - Calls HCM to confirm deduction
T2: Meanwhile, HCM grants 5-day work anniversary bonus
    - HCM balance becomes 15 days
T3: HCM confirms deduction from T1
    - HCM balance becomes 13 days
T4: ExampleHR syncs with HCM
    - Local: 8 days, HCM: 13 days
    - Conflict detected! Which is correct?
```

**Impact**: Data inconsistency, incorrect balance display, potential overbooking.

#### Challenge 2: Independent HCM Updates
**Problem**: HCM can update balances without notifying ExampleHR.

**Scenarios**:
- Work anniversary: +5 days automatically
- Year-start refresh: Reset to annual allocation
- Manual correction: HR adjusts balance due to error
- Termination: Balance set to 0

**Impact**: ExampleHR may have stale balance data, leading to incorrect decisions.

#### Challenge 3: Real-Time API Limitations
**Problem**: HCM real-time API may not always be available or reliable.

**Scenarios**:
- Network timeout during request submission
- HCM service degradation (slow responses)
- Transient errors (5xx responses)
- Invalid requests (4xx responses)

**Impact**: User experience degradation, need for fallback strategies.

#### Challenge 4: Unreliable Error Responses
**Problem**: HCM may not always return errors for invalid requests.

**Scenarios**:
- HCM accepts invalid dimension combination (e.g., employee not assigned to location)
- HCM accepts deduction despite insufficient balance
- HCM silently fails to update balance
- HCM returns success but balance unchanged

**Impact**: Data corruption, balance inconsistencies, need for defensive validation.

#### Challenge 5: Pending Request Handling
**Problem**: Balance can change while request is pending approval.

**Scenario**:
```
T0: Employee requests 2 days (balance: 10 → 8 reserved)
T1: Manager approves request
T2: HCM batch sync runs, grants 5-day bonus (balance: 10 → 15)
T3: System tries to deduct 2 days from HCM
    - HCM balance is now 15, not 10
    - Should deduction still happen? Yes, request was approved
    - But available balance increased, so no issue
```

**Impact**: Need to handle balance changes during request lifecycle.

#### Challenge 6: Concurrent Request Handling
**Problem**: Multiple requests from same employee in parallel.

**Scenario**:
```
T0: Employee has 10 days
T1: Request A submitted (2 days) - reserve 2 days
T2: Request B submitted (3 days) - reserve 3 days
T3: Manager approves Request A (8 days remaining)
T4: Manager approves Request B (5 days remaining)
T5: Both requests confirmed with HCM
    - Total deducted: 5 days
    - But HCM may reject one if balance insufficient
```

**Impact**: Need optimistic locking and transaction handling.

#### Challenge 7: Multi-Dimensional Balances
**Problem**: Balances are per-employee per-location, with potential additional dimensions.

**Dimensions**:
- Employee ID
- Location ID
- Leave type (vacation, sick, personal)
- Year/period
- Policy variations

**Impact**: Complex schema, batch sync must handle all dimensions.

#### Challenge 8: Audit & Compliance
**Problem**: Need to track all balance changes for audit purposes.

**Scenarios**:
- Employee disputes balance
- HR needs to audit balance changes
- Regulatory compliance (labor laws)
- Forensic analysis of sync issues

**Impact**: Comprehensive logging required.

---

## 2. Proposed Solution Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ExampleHR Microservice                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ REST API Layer                                       │   │
│  │ - Request endpoints (submit, approve, view)          │   │
│  │ - Balance endpoints (get, sync status)               │   │
│  │ - Admin endpoints (trigger sync, view logs)          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Service Layer                                        │   │
│  │ - Request Service (lifecycle management)             │   │
│  │ - Balance Service (local balance operations)         │   │
│  │ - HCM Integration Service (API calls, retry logic)   │   │
│  │ - Sync Service (batch sync, reconciliation)          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Data Layer                                           │   │
│  │ - SQLite Database                                    │   │
│  │ - TypeORM Entities                                   │   │
│  │ - Migrations                                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Infrastructure                                       │   │
│  │ - Error handling & retry logic                       │   │
│  │ - Circuit breaker                                    │   │
│  │ - Caching layer (in-memory)                          │   │
│  │ - Logging & audit trail                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
         │
         │ HTTP/REST
         │
┌────────▼──────────────────────────────────────────────────┐
│              External HCM System                           │
│              (Workday/SAP)                                 │
│                                                            │
│  - Real-time API: GET/POST /balance/:emp/:loc            │
│  - Batch API: POST /batch/balances                        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 2.2 Core Design Principles

#### Principle 1: HCM as Source of Truth
- **Decision**: HCM balance always wins in case of conflict
- **Rationale**: HCM is the authoritative system; ExampleHR is a client
- **Implementation**: Batch sync overwrites local balances; defensive validation checks against HCM

#### Principle 2: Optimistic Locking
- **Decision**: Reserve balance locally, confirm with HCM asynchronously
- **Rationale**: Provides instant feedback to users while maintaining correctness
- **Implementation**: Request status tracks reservation; HCM confirmation is separate step

#### Principle 3: Eventual Consistency
- **Decision**: Accept temporary inconsistency; reconcile via periodic batch sync
- **Rationale**: Real-time consistency is impossible with unreliable HCM API
- **Implementation**: Scheduled batch sync (hourly); event-driven sync (work anniversary)

#### Principle 4: Defensive Validation
- **Decision**: Don't trust HCM error responses; validate locally
- **Rationale**: HCM may not always return errors for invalid requests
- **Implementation**: Local balance checks before and after HCM calls

#### Principle 5: Fail-Safe Defaults
- **Decision**: When HCM is unavailable, use cached balance with warnings
- **Rationale**: Better to serve stale data than reject all requests
- **Implementation**: Circuit breaker pattern; fallback to last known balance

### 2.3 Request Lifecycle with Proposed Solution

```
STEP 1: SUBMISSION
├─ Input validation (employee, location, dates, days)
├─ Local balance check (defensive)
├─ HCM real-time API call (verify balance)
│  ├─ Success: Proceed
│  ├─ Transient error: Retry with backoff
│  └─ Persistent error: Use cached balance with warning
├─ Reserve balance locally (optimistic lock)
├─ Create request record (status: PENDING_APPROVAL)
└─ Notify manager

STEP 2: MANAGER APPROVAL
├─ Manager reviews request
├─ Manager approves/rejects
├─ Update request status (APPROVED/REJECTED)
├─ If rejected: Release reserved balance
└─ If approved: Proceed to confirmation

STEP 3: CONFIRMATION WITH HCM
├─ Call HCM real-time API to deduct balance
│  ├─ Success: Update local balance, mark CONFIRMED
│  ├─ Insufficient balance: Rollback, mark FAILED
│  ├─ Invalid dimension: Rollback, mark FAILED
│  └─ Transient error: Retry with backoff
├─ Create sync log entry
└─ Notify employee

STEP 4: RECONCILIATION (Batch Sync)
├─ Scheduled: Every hour
├─ Event-driven: Work anniversary, year-start refresh
├─ Call HCM batch API to get all balances
├─ For each balance:
│  ├─ Compare with local
│  ├─ If different: Check pending requests
│  ├─ Apply HCM balance (source of truth)
│  └─ Log conflict if detected
├─ Notify employees of significant changes
└─ Update sync status
```

### 2.4 Data Model

#### Core Entities

**Employee**
```
- id (UUID)
- hcm_employee_id (string, external ID)
- name (string)
- email (string)
- created_at (timestamp)
- updated_at (timestamp)
```

**Location**
```
- id (UUID)
- hcm_location_id (string, external ID)
- name (string)
- timezone (string)
- created_at (timestamp)
```

**TimeOffBalance**
```
- id (UUID)
- employee_id (UUID, FK)
- location_id (UUID, FK)
- balance (decimal)
- reserved (decimal) - from pending requests
- available (decimal) - balance - reserved
- last_synced_at (timestamp)
- hcm_version (string) - for optimistic locking
- created_at (timestamp)
- updated_at (timestamp)
- UNIQUE(employee_id, location_id)
```

**TimeOffRequest**
```
- id (UUID)
- employee_id (UUID, FK)
- location_id (UUID, FK)
- days (decimal)
- start_date (date)
- end_date (date)
- status (enum: DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, CONFIRMED, FAILED, CANCELLED)
- manager_id (UUID, FK)
- manager_comment (text)
- hcm_confirmation_id (string) - external ID from HCM
- created_at (timestamp)
- updated_at (timestamp)
- submitted_at (timestamp)
- approved_at (timestamp)
- confirmed_at (timestamp)
```

**SyncLog**
```
- id (UUID)
- type (enum: REAL_TIME_CHECK, REAL_TIME_DEDUCT, BATCH_SYNC)
- status (enum: SUCCESS, CONFLICT, ERROR, RETRY)
- employee_id (UUID, FK, nullable)
- location_id (UUID, FK, nullable)
- old_balance (decimal, nullable)
- new_balance (decimal, nullable)
- delta (decimal, nullable)
- error_message (text, nullable)
- details (JSON) - additional context
- created_at (timestamp)
```

### 2.5 API Contracts

#### Employee Endpoints

**Submit Time-Off Request**
```
POST /api/v1/requests
Authorization: Bearer <token>
Content-Type: application/json

{
  "days": 2,
  "startDate": "2026-05-01",
  "endDate": "2026-05-02",
  "reason": "Vacation"
}

Response 201:
{
  "id": "req-123",
  "status": "PENDING_APPROVAL",
  "days": 2,
  "availableBalance": 8,
  "message": "Request submitted successfully"
}

Response 400:
{
  "error": "INSUFFICIENT_BALANCE",
  "message": "Only 1 day available, 2 requested"
}

Response 503:
{
  "error": "HCM_UNAVAILABLE",
  "message": "Could not verify balance with HCM. Using cached balance (may be stale)."
}
```

**Get Current Balance**
```
GET /api/v1/balance?locationId=loc-123
Authorization: Bearer <token>

Response 200:
{
  "balance": 10,
  "reserved": 2,
  "available": 8,
  "lastSyncedAt": "2026-04-17T10:30:00Z",
  "isCached": false
}

Response 200 (Cached):
{
  "balance": 10,
  "reserved": 2,
  "available": 8,
  "lastSyncedAt": "2026-04-17T09:45:00Z",
  "isCached": true,
  "warning": "Balance may be stale (HCM unavailable)"
}
```

**Get Request History**
```
GET /api/v1/requests?status=CONFIRMED&limit=10
Authorization: Bearer <token>

Response 200:
{
  "requests": [
    {
      "id": "req-123",
      "days": 2,
      "status": "CONFIRMED",
      "startDate": "2026-05-01",
      "endDate": "2026-05-02",
      "approvedAt": "2026-04-17T11:00:00Z",
      "confirmedAt": "2026-04-17T11:05:00Z"
    }
  ],
  "total": 1
}
```

#### Manager Endpoints

**Get Pending Requests**
```
GET /api/v1/manager/requests?status=PENDING_APPROVAL
Authorization: Bearer <token>

Response 200:
{
  "requests": [
    {
      "id": "req-123",
      "employeeName": "John Doe",
      "days": 2,
      "startDate": "2026-05-01",
      "currentBalance": 10,
      "balanceAfterRequest": 8,
      "submittedAt": "2026-04-17T10:30:00Z"
    }
  ],
  "total": 1
}
```

**Approve/Reject Request**
```
POST /api/v1/manager/requests/{id}/approve
Authorization: Bearer <token>
Content-Type: application/json

{
  "comment": "Approved"
}

Response 200:
{
  "id": "req-123",
  "status": "APPROVED",
  "approvedAt": "2026-04-17T11:00:00Z"
}

Response 202:
{
  "id": "req-123",
  "status": "APPROVED",
  "message": "Request approved. Confirming with HCM..."
}
```

#### Admin Endpoints

**Trigger Batch Sync**
```
POST /api/v1/admin/sync/batch
Authorization: Bearer <admin-token>

Response 202:
{
  "syncId": "sync-456",
  "status": "IN_PROGRESS",
  "message": "Batch sync started"
}
```

**Get Sync Status**
```
GET /api/v1/admin/sync/{syncId}
Authorization: Bearer <admin-token>

Response 200:
{
  "syncId": "sync-456",
  "status": "COMPLETED",
  "startedAt": "2026-04-17T11:00:00Z",
  "completedAt": "2026-04-17T11:05:00Z",
  "recordsProcessed": 150,
  "conflictsDetected": 3,
  "errors": []
}
```

### 2.6 HCM Integration

#### Real-Time API Calls

**Check Balance**
```
GET /api/balance/{employeeId}/{locationId}

Response 200:
{
  "employeeId": "emp-123",
  "locationId": "loc-456",
  "balance": 10,
  "currency": "days",
  "lastUpdated": "2026-04-17T10:00:00Z"
}

Response 400:
{
  "error": "INVALID_DIMENSION",
  "message": "Employee not assigned to location"
}

Response 503:
{
  "error": "SERVICE_UNAVAILABLE",
  "message": "HCM service temporarily unavailable"
}
```

**Deduct Balance**
```
POST /api/balance/{employeeId}/{locationId}

{
  "deduct": 2,
  "reason": "TIME_OFF_REQUEST",
  "requestId": "req-123"
}

Response 200:
{
  "employeeId": "emp-123",
  "locationId": "loc-456",
  "previousBalance": 10,
  "newBalance": 8,
  "deducted": 2
}

Response 400:
{
  "error": "INSUFFICIENT_BALANCE",
  "message": "Only 1 day available, 2 requested"
}
```

#### Batch API

**Get All Balances**
```
POST /api/batch/balances

{
  "since": "2026-04-17T10:00:00Z"
}

Response 200:
{
  "balances": [
    {
      "employeeId": "emp-123",
      "locationId": "loc-456",
      "balance": 10,
      "lastUpdated": "2026-04-17T10:00:00Z"
    },
    ...
  ],
  "timestamp": "2026-04-17T11:00:00Z",
  "count": 150
}
```

### 2.7 Error Handling Strategy

#### Transient Errors (Retry)
**Errors**: Network timeout, 5xx, temporary unavailability

**Strategy**:
```
Retry 1: Wait 1s
Retry 2: Wait 2s
Retry 3: Wait 4s
After 3 failures: Circuit breaker opens
```

**Fallback**: Use cached balance with warning

#### Client Errors (Fail Fast)
**Errors**: Invalid dimension (400), insufficient balance (400)

**Strategy**: Immediately reject request, notify user

#### Persistent Errors (Circuit Breaker)
**Condition**: 3+ consecutive failures

**Strategy**:
```
State: OPEN (reject all requests)
Duration: 60 seconds
After 60s: Try one request (HALF_OPEN state)
  - Success: Close circuit, resume normal
  - Failure: Reopen circuit, wait 60s more
```

**Fallback**: Use cached balance with warning

#### Conflict Handling
**Condition**: HCM balance ≠ Local balance

**Strategy**:
```
1. HCM balance is source of truth
2. Check pending requests (reserved balance)
3. If pending request affected:
   - Notify employee
   - Adjust available balance
4. Log conflict with details
5. Alert admin if significant change (>20% delta)
```

### 2.8 Sync Strategy

#### Real-Time Sync
**Trigger**: Before request submission, before request confirmation

**Flow**:
```
1. Check cache (< 5 min old?)
   - YES: Return cached
   - NO: Call HCM API
2. On success: Update cache, return balance
3. On failure: Return cached with warning
4. Update timestamp
```

**Pros**: Instant feedback, accurate balance
**Cons**: Depends on HCM availability

#### Batch Sync
**Trigger**: 
- Scheduled: Every hour (configurable)
- Event-driven: Work anniversary, year-start refresh
- Manual: Admin trigger

**Flow**:
```
1. Call HCM batch API
2. For each balance:
   - Compare with local
   - Apply HCM balance (source of truth)
   - Log conflicts
3. Atomic transaction (all or nothing)
4. Notify affected employees
5. Update sync status
```

**Pros**: Comprehensive reconciliation, handles all balances
**Cons**: Delayed (hourly), batch processing overhead

---

## 3. Alternative Approaches Considered

### Alternative 1: Event Sourcing

**Approach**: Store all balance changes as immutable events, rebuild state on demand.

**Pros**:
- Complete audit trail
- Can replay history
- Temporal queries (balance at any point in time)
- Handles concurrent updates naturally

**Cons**:
- Significant complexity
- Requires event store infrastructure
- Slower queries (need to replay events)
- Harder to debug
- Overkill for this use case

**Decision**: **REJECTED** - Complexity not justified by requirements. Sync logs provide sufficient audit trail.

---

### Alternative 2: CQRS (Command Query Responsibility Segregation)

**Approach**: Separate read and write models. Writes go to HCM, reads from local cache.

**Pros**:
- Optimized read performance
- Decoupled read/write concerns
- Easier to scale reads independently

**Cons**:
- Significant complexity
- Requires eventual consistency handling
- Harder to maintain consistency
- Overkill for this scale

**Decision**: **REJECTED** - Not needed for current scale. Simple caching sufficient.

---

### Alternative 3: Saga Pattern for Distributed Transactions

**Approach**: Implement compensating transactions for request approval workflow.

**Pros**:
- Handles distributed transaction failures
- Explicit rollback logic
- Clear error handling

**Cons**:
- Complex state machine
- Difficult to debug
- Requires careful ordering of operations
- Not needed since HCM is single source of truth

**Decision**: **REJECTED** - Simpler approach sufficient. HCM always wins, no need for complex compensation.

---

### Alternative 4: Strong Consistency with Pessimistic Locking

**Approach**: Lock balance in HCM before request submission, release after confirmation.

**Pros**:
- Guaranteed consistency
- No race conditions
- Simple to reason about

**Cons**:
- Requires HCM support for locking
- Slow (wait for HCM lock)
- Poor user experience (no instant feedback)
- HCM may not support locking

**Decision**: **REJECTED** - Violates requirement for instant feedback. Optimistic locking better.

---

### Alternative 5: Pull-Only Sync (No Real-Time Checks)

**Approach**: Only sync via batch API, no real-time checks before request.

**Pros**:
- Simpler implementation
- No dependency on real-time API
- Lower HCM load

**Cons**:
- Stale balance data
- Requests may fail after approval
- Poor user experience
- Violates requirement for instant feedback

**Decision**: **REJECTED** - Real-time checks necessary for user experience.

----

### Alternative 7: Caching Strategy - TTL vs Event-Based

**Approach A (TTL)**: Cache balance for 5 minutes, then refresh.

**Pros**: Simple, predictable
**Cons**: Stale data between refreshes

**Approach B (Event-Based)**: Invalidate cache on any balance change.

**Pros**: Always fresh
**Cons**: Complex, requires event infrastructure

**Decision**: **TTL CHOSEN** - Simple and sufficient. 5-minute window acceptable.

---

### Alternative 8: Database - SQLite vs PostgreSQL

**Approach A (SQLite)**: Single-file database, no server needed.

**Pros**:
- Simple deployment
- No infrastructure needed
- Good for testing
- Sufficient for single-instance service

**Cons**:
- Limited concurrency
- No replication
- Not suitable for high-scale

**Approach B (PostgreSQL)**: Full-featured relational database.

**Pros**:
- Better concurrency
- Replication support
- Better for scale

**Cons**:
- More infrastructure
- More complex deployment
- Overkill for initial requirements

**Decision**: **SQLITE CHOSEN** - Per requirements. Can migrate to PostgreSQL later if needed.

---

## 4. Implementation Strategy

### 4.1 Technology Stack

**Framework**: NestJS (TypeScript)
- Modular architecture
- Built-in dependency injection
- Excellent testing support
- Strong typing

**Database**: SQLite with TypeORM
- Simple deployment
- Type-safe queries
- Migration support
- Good for testing

**Testing**: Jest + Supertest
- Excellent TypeScript support
- Fast test execution
- Good coverage reporting
- Built into NestJS

**HTTP Client**: Axios
- Promise-based
- Interceptor support (for retry logic)
- Good error handling

**Caching**: Node-cache (in-memory)
- Simple to use
- TTL support
- Sufficient for single instance

**Logging**: Winston
- Structured logging
- Multiple transports
- Good for debugging

### 4.2 Project Structure

```
src/
├── main.ts                          # Application bootstrap with CORS, rate limiting
├── app.module.ts
├── config/
│   ├── config.service.ts            # Environment configuration
│   └── database.config.ts           # TypeORM configuration
├── modules/
│   ├── employees/
│   │   ├── entities/
│   │   │   └── employee.entity.ts
│   │   └── employees.module.ts
│   ├── locations/
│   │   ├── entities/
│   │   │   └── location.entity.ts
│   │   └── locations.module.ts
│   ├── time-off/
│   │   ├── entities/
│   │   │   └── time-off-request.entity.ts
│   │   ├── dto/
│   │   │   ├── submit-request.dto.ts
│   │   │   ├── approve-request.dto.ts
│   │   │   ├── reject-request.dto.ts
│   │   │   └── request-response.dto.ts
│   │   ├── services/
│   │   │   ├── time-off-request.service.ts
│   │   │   └── time-off-request.service.spec.ts
│   │   ├── controllers/
│   │   │   ├── time-off.controller.ts
│   │   │   └── manager.controller.ts
│   │   └── time-off.module.ts
│   ├── balance/
│   │   ├── entities/
│   │   │   └── time-off-balance.entity.ts
│   │   ├── services/
│   │   │   ├── balance.service.ts
│   │   │   └── balance.service.spec.ts
│   │   └── balance.module.ts
│   ├── hcm-integration/
│   │   ├── services/
│   │   │   ├── hcm-integration.service.ts
│   │   │   └── hcm-integration.service.spec.ts
│   │   └── hcm-integration.module.ts
│   ├── sync/
│   │   ├── entities/
│   │   │   └── sync-log.entity.ts
│   │   ├── services/
│   │   │   ├── sync.service.ts
│   │   │   └── sync.service.spec.ts
│   │   ├── controllers/
│   │   │   └── admin.controller.ts
│   │   └── sync.module.ts
│   └── health/
│       ├── controllers/
│       │   └── health.controller.ts
│       └── health.module.ts
├── common/
│   ├── guards/
│   │   ├── auth.guard.ts
│   │   └── roles.guard.ts
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── roles.decorator.ts
│   ├── logger.ts
│   └── index.ts
└── database/
    └── seeders/
        └── seed.ts
```

**mock-hcm-server/**
```
├── server.js                        # Express mock HCM server with error injection & latency simulation
├── package.json
└── node_modules/
```

**test/**
```
├── app.e2e-spec.ts                 # Basic E2E tests
├── critical-paths.e2e-spec.ts      # Critical path tests
└── security.e2e-spec.ts            # Security & authentication tests
```

### 4.3 Key Services

**BalanceService**
- Get balance (with caching)
- Update balance (local)
- Reserve balance (for pending requests)
- Release balance (on rejection)

**HCMIntegrationService**
- Real-time balance check
- Real-time balance deduction
- Batch balance sync
- Error handling and retry logic
- Circuit breaker management

**TimeOffRequestService**
- Submit request
- Approve/reject request
- Confirm with HCM
- Get request history
- Handle rollbacks

**SyncService**
- Scheduled batch sync
- Conflict resolution
- Audit logging
- Notification handling

---

## 5. Testing Strategy

### 5.1 Unit Tests

**Coverage Target**: 85%+

**Test Categories**:
- Service logic (balance calculations, state transitions)
- DTO validation
- Error handling
- Edge cases (negative balance, concurrent requests)

**Mock Strategy**:
- Mock HCM client
- Mock database
- Mock cache

### 5.2 Integration Tests

**Coverage Target**: 70%+

**Test Categories**:
- Database operations (CRUD, transactions)
- HCM integration with mock server
- Request lifecycle (submit → approve → confirm)
- Sync operations (batch sync, conflict resolution)
- Error recovery (retry, circuit breaker)

**Implemented Test Files**:
- `src/modules/balance/services/balance.service.spec.ts` - Balance operations (getBalance, reserveBalance, releaseBalance, deductBalance)
- `src/modules/hcm-integration/services/hcm-integration.service.spec.ts` - HCM API calls and circuit breaker behavior
- `src/modules/time-off/services/time-off-request.service.spec.ts` - Request submission, approval, rejection with transaction handling

**Mock Strategy**:
- Real SQLite test database
- Mock HCM server (Express)
- Real service instances

### 5.3 E2E Tests

**Coverage Target**: 50%+

**Test Scenarios**:
1. Happy path: Submit request → Approve → Confirm
2. Insufficient balance: Request rejected
3. HCM unavailable: Use cached balance
4. Concurrent requests: Multiple requests from same employee
5. Batch sync: Balance updated during pending request
6. Conflict resolution: HCM balance overrides local
7. Manager approval: Approve/reject workflow
8. Error recovery: Retry and circuit breaker

**Implemented Test Files**:
- `test/app.e2e-spec.ts` - Basic E2E tests (health, request submission, balance retrieval, manager approval, admin sync)
- `test/critical-paths.e2e-spec.ts` - Critical path tests (request validation, balance checks, state transitions, RBAC, concurrency)
- `test/security.e2e-spec.ts` - Security tests (authentication, authorization, token validation, role-based access control)

**Mock Strategy**:
- Real NestJS app
- Mock HCM server (Express with error injection and latency simulation endpoints)
- Real SQLite test database (separate test databases for each test suite)
- Supertest for HTTP calls

### 5.4 Test Data

**Seed Data**:
- 10 employees (emp-1 to emp-10)
- 3 locations (loc-1 to loc-3)
- Various balance scenarios (sufficient, insufficient, edge cases)

**Test Fixtures**:
- Request templates
- Balance templates
- HCM response templates

### 5.5 Coverage Reporting

**Tools**: Istanbul/NYC

**Targets**:
- Statements: 85%+
- Branches: 80%+
- Functions: 85%+
- Lines: 85%+

**Critical Paths** (100% coverage required):
- Balance validation logic
- Request state transitions
- HCM error handling
- Sync conflict resolution

---

## 6. Deployment & Operations

### 6.1 Deployment Strategy

**Environment**: Single NestJS instance + SQLite

**Deployment Steps**:
1. Build Docker image
2. Run migrations
3. Seed initial data
4. Start service with CORS and rate limiting enabled
5. Health check

**Configuration** (via environment variables):
- `NODE_ENV` - Environment (development/test/production)
- `PORT` - Server port (default: 3000)
- `DATABASE_PATH` - SQLite database file path (default: ./data/timeoff.db)
- `HCM_BASE_URL` - HCM API base URL
- `HCM_API_KEY` - HCM API authentication key
- `HCM_TIMEOUT` - HCM request timeout in ms (default: 5000)
- `HCM_RETRY_ATTEMPTS` - Number of retry attempts (default: 3)
- `HCM_RETRY_DELAY` - Initial retry delay in ms (default: 1000)
- `CACHE_TTL` - Cache time-to-live in seconds (default: 300)
- `SYNC_INTERVAL` - Batch sync interval in ms (default: 3600000 = 1 hour)
- `SYNC_BATCH_SIZE` - Batch sync page size (default: 100)
- `CIRCUIT_BREAKER_THRESHOLD` - Failure threshold to open circuit (default: 3)
- `CIRCUIT_BREAKER_TIMEOUT` - Circuit breaker timeout in ms (default: 60000)
- `LOG_LEVEL` - Winston log level (default: info)
- `CORS_ORIGIN` - CORS origin (default: *)

**Security Features**:
- CORS enabled with configurable origin
- Rate limiting: 100 requests per 15 minutes (global), 5 requests per 15 minutes (auth endpoints)
- Input validation with class-validator (whitelist, forbid non-whitelisted)
- Bearer token authentication
- Role-based access control (employee, manager, admin)

### 6.2 Monitoring & Logging

**Implemented Logging** (Winston):
- Structured JSON logging to console and files (error.log, combined.log)
- All HCM API calls logged with request/response details
- All balance changes logged with employee, location, and reason
- All sync operations logged with conflict details
- All errors logged with stack traces
- Request lifecycle events logged (submit, approve, reject, confirm)

**Health Check Endpoint**:
- `GET /health` - Returns service status and circuit breaker state
- Response includes: status, timestamp, service version, HCM circuit breaker state, failure count

**Alerts** (Manual monitoring required):
- HCM API unavailable (circuit breaker open)
- Sync conflicts detected (logged in SyncLog)
- Batch sync failures (logged with error details)
- High error rates (visible in combined.log)

### 6.3 Disaster Recovery

**Backup Strategy**:
- SQLite database backed up hourly
- Sync logs retained for 90 days
- Request history retained indefinitely

**Recovery Procedures**:
- Restore from backup
- Trigger full batch sync to reconcile
- Notify affected employees

---

## 7. Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| HCM API unavailable | Users can't submit requests | Medium | Circuit breaker, cached balance fallback |
| Data inconsistency | Incorrect balance display | Medium | Batch sync, defensive validation |
| Concurrent request race condition | Overbooking | Low | Optimistic locking, transaction handling |
| Balance sync failure | Stale data | Low | Retry logic, manual sync trigger |
| Database corruption | Data loss | Low | Regular backups, transaction handling |
| Performance degradation | Slow API response | Low | Caching, database indexing |

---

## 9. Success Criteria

1. **Functional**:
   - All endpoints working as specified
   - Request lifecycle complete
   - Balance sync working correctly
   - Error handling robust

2. **Performance**:
   - Request submission < 500ms (with cache)
   - Balance check < 200ms (cached)
   - Batch sync < 5 minutes for 1000 employees
   - API response time < 1s (p95)

3. **Reliability**:
   - 99.5% uptime
   - Zero data loss
   - Automatic error recovery
   - Circuit breaker prevents cascading failures

4. **Testing**:
   - 85%+ code coverage
   - All critical paths 100% covered
   - All test scenarios passing
   - E2E tests for all major flows

5. **Operations**:
   - Clear logging and monitoring
   - Easy to debug issues
   - Simple deployment process
   - Clear documentation

---

## 10. Conclusion

The proposed solution balances user experience (instant feedback) with data integrity (guaranteed correctness) through optimistic locking, defensive validation, and comprehensive error handling. The use of HCM as source of truth simplifies the architecture while the batch sync mechanism ensures eventual consistency.

The implementation is pragmatic, avoiding over-engineering while addressing all identified challenges. The comprehensive test suite ensures robustness and guards against regressions.

---

## Appendix: Glossary

- **HCM**: Human Capital Management system (Workday, SAP, etc.)
- **Balance**: Available time-off days for an employee at a location
- **Request**: Employee's time-off request
- **Sync**: Synchronization of balance data between ExampleHR and HCM
- **Conflict**: Discrepancy between local and HCM balance
- **Optimistic Locking**: Assume no conflict, detect and handle if it occurs
- **Pessimistic Locking**: Lock resource before modification
- **Circuit Breaker**: Pattern to prevent cascading failures
- **Eventual Consistency**: System becomes consistent over time
- **Source of Truth**: Authoritative system (HCM in this case)
