import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { authenticate } from './middleware/auth.middleware.js';
import { requireAuth, requireRole, requireOrganization } from './middleware/authorize.middleware.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRateLimiter, loginRateLimiter, pinViewRateLimiter } from './middleware/rateLimiter.js';
import { validateRequest } from './middleware/validate.middleware.js';
import { getHealth } from './modules/health/health.controller.js';
import { getAppVersionHandler } from './modules/version/version.controller.js';
import {
  login,
  logout,
  getCurrentUser,
  changePinHandler,
  getRegistrationStatus,
  registerPresidentHandler,
  getMyPinHandler,
} from './modules/auth/auth.controller.js';
import { loginSchema, changePinSchema, registerPresidentSchema } from './modules/auth/auth.validation.js';
import { getCurrentOrganization, getOrganizationById, permanentDeleteMandalHandler } from './modules/organization/organization.controller.js';
import { permanentDeleteMandalSchema } from './modules/organization/organization.validation.js';
import {
  createMemberHandler,
  listMembersHandler,
  getMemberHandler,
  updateMemberStatusHandler,
  updateMemberRoleHandler,
  deleteMemberHandler,
  getMemberPinHandler,
} from './modules/member/member.controller.js';
import {
  createMemberSchema,
  memberListQuerySchema,
  updateMemberStatusSchema,
  updateMemberRoleSchema,
} from './modules/member/member.validation.js';
import {
  setMemberBishiConfigHandler,
  getMemberBishiConfigHandler,
  generateCycleHandler,
  getMemberBishiRecordsHandler,
  getOrganizationBishiOverviewHandler,
  deleteBishiRecordHandler,
} from './modules/bishi/bishi.controller.js';
import {
  setBishiConfigSchema,
  generateBishiCycleSchema,
} from './modules/bishi/bishi.validation.js';
import {
  recordCashPaymentHandler,
  getMyPassbookHandler,
  getMemberPassbookHandler,
  getOrganizationLedgerHandler,
  getTransactionReceiptHandler,
  getMandalFinancialSummaryHandler,
  recordVarganiContributionHandler,
} from './modules/ledger/ledger.controller.js';
import {
  recordCashPaymentSchema,
  recordVarganiContributionSchema,
} from './modules/ledger/ledger.validation.js';
import {
  createLoanHandler,
  recordCashLoanRepaymentHandler,
  getMemberLoansHandler,
  getMyLoansHandler,
  getMandalLoansHandler,
  deleteLoanHandler,
} from './modules/loans/loan.controller.js';
import {
  createLoanSchema,
  recordLoanRepaymentSchema,
} from './modules/loans/loan.validation.js';
import {
  createExpenseHandler,
  getMandalExpensesHandler,
  getExpenseByIdHandler,
  getExpenseCategoriesHandler,
  deleteExpenseHandler,
} from './modules/expenses/expense.controller.js';
import { createExpenseSchema } from './modules/expenses/expense.validation.js';
import {
  getMonthlyStatementHandler,
  exportAuditCsvHandler,
} from './modules/reporting/reporting.controller.js';
import {
  monthlyStatementQuerySchema,
  auditExportQuerySchema,
} from './modules/reporting/reporting.validation.js';
import {
  getPaymentConfigHandler,
  upsertPaymentConfigHandler,
  updatePaymentConfigStatusHandler,
  createPaymentOrderHandler,
  verifyPaymentHandler,
  webhookHandler,
  getOrderStatusHandler,
  getPaymentOrdersHandler,
} from './modules/payments/payment.controller.js';
import {
  upsertPaymentConfigSchema,
  updatePaymentConfigStatusSchema,
  createPaymentOrderSchema,
  verifyPaymentSchema,
} from './modules/payments/payment.validation.js';
import {
  getNotificationsHandler,
  getUnreadCountHandler,
  markAsReadHandler,
  markAllAsReadHandler,
  registerDeviceTokenHandler,
  unregisterDeviceTokenHandler,
  runSchedulerHandler,
} from './modules/notifications/notification.controller.js';
import {
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
  getNotificationsQuerySchema,
} from './modules/notifications/notification.validation.js';
import { ROLES } from './types/roles.js';

export function createApp(): express.Application {
  const app = express();

  // 1. Security Headers
  app.use(helmet());

  // 2. CORS setup (strict origins only, no wildcard permitted)
  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '*' && o.length > 0);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow mobile apps (origin may be undefined for mobile native requests, or https://localhost / capacitor://localhost) or listed origins
        if (
          !origin ||
          origin === 'https://localhost' ||
          origin === 'capacitor://localhost' ||
          origin === 'http://localhost' ||
          allowedOrigins.includes(origin)
        ) {
          callback(null, true);
        } else {
          callback(new Error('CORS policy: Origin not allowed'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // 3. Parsers with size limits & rawBody capture for webhook signature verification
  app.use(
    express.json({
      limit: '50kb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );
  app.use(cookieParser());

  // 4. Global API rate limiting
  app.use('/api', apiRateLimiter);

  // 5. Global session authentication extractor
  app.use(authenticate);

  // 6. Public Healthcheck & Version Metadata
  app.get('/api/health', getHealth);
  app.get('/api/app/version', getAppVersionHandler);

  // 7. Auth Routes
  app.get('/api/auth/registration-status', getRegistrationStatus);
  app.post(
    '/api/auth/register-president',
    loginRateLimiter,
    validateRequest({ body: registerPresidentSchema }),
    registerPresidentHandler
  );
  app.post('/api/auth/login', loginRateLimiter, validateRequest({ body: loginSchema }), login);
  app.post('/api/auth/logout', requireAuth, logout);
  app.get('/api/auth/me', requireAuth, getCurrentUser);
  app.patch('/api/auth/pin', requireAuth, loginRateLimiter, validateRequest({ body: changePinSchema }), changePinHandler);
  app.get('/api/auth/my-pin', requireAuth, requireRole([ROLES.PRESIDENT]), pinViewRateLimiter, getMyPinHandler);

  // 8. Organization Foundation Routes (Scoping & Tenant Protection)
  app.get('/api/organizations/current', requireAuth, getCurrentOrganization);
  app.get('/api/organizations/:orgId', requireAuth, requireOrganization(), getOrganizationById);
  app.post(
    '/api/organizations/permanent-delete',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    validateRequest({ body: permanentDeleteMandalSchema }),
    permanentDeleteMandalHandler
  );

  // 9. Member Management Foundation Routes (President-Only Server-Side RBAC)
  app.post(
    '/api/members',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    validateRequest({ body: createMemberSchema }),
    createMemberHandler
  );
  app.get(
    '/api/members',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ query: memberListQuerySchema }),
    listMembersHandler
  );
  app.get(
    '/api/members/:memberId',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getMemberHandler
  );
  app.get(
    '/api/members/:memberId/pin',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    pinViewRateLimiter,
    getMemberPinHandler
  );
  app.patch(
    '/api/members/:memberId/status',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    validateRequest({ body: updateMemberStatusSchema }),
    updateMemberStatusHandler
  );
  app.patch(
    '/api/members/:memberId/role',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    validateRequest({ body: updateMemberRoleSchema }),
    updateMemberRoleHandler
  );
  app.delete(
    '/api/members/:memberId',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    deleteMemberHandler
  );

  // 10. Bishi Foundation Routes (अध्यक्ष व खजिनदार बीसी रचना व मासिक चक्र)
  // President & Treasurer sets/updates member Bishi configuration:
  app.post(
    '/api/members/:memberId/bishi-config',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ body: setBishiConfigSchema }),
    setMemberBishiConfigHandler
  );
  // Get member Bishi configuration (President, Treasurer, or self Member):
  app.get(
    '/api/members/:memberId/bishi-config',
    requireAuth,
    getMemberBishiConfigHandler
  );
  // Get member Bishi records (President, Treasurer, or self Member):
  app.get(
    '/api/members/:memberId/bishi-records',
    requireAuth,
    getMemberBishiRecordsHandler
  );
  // President & Treasurer generates monthly Bishi cycle:
  app.post(
    '/api/bishi/generate-cycle',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ body: generateBishiCycleSchema }),
    generateCycleHandler
  );
  // Mandal Bishi overview (President, Treasurer):
  app.get(
    '/api/bishi/overview',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getOrganizationBishiOverviewHandler
  );
  // Delete unpaid/unreferenced Bishi record (President & Treasurer):
  app.delete(
    '/api/bishi/records/:recordId',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    deleteBishiRecordHandler
  );

  // 11. Financial Ledger & Cash Payment Routes (अधिकृत रोख जमा व डिजिटल पासबुक)
  // Record real cash payment for a Bishi monthly record (President & Treasurer):
  app.post(
    '/api/bishi/:bishiRecordId/cash-payment',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ body: recordCashPaymentSchema }),
    recordCashPaymentHandler
  );
  // Logged-in user's own passbook:
  app.get('/api/passbook/me', requireAuth, getMyPassbookHandler);
  // Member passbook (Self, President, or Treasurer):
  app.get('/api/passbook/member/:memberId', requireAuth, getMemberPassbookHandler);
  // Mandal-wide financial ledger (President & Treasurer):
  app.get(
    '/api/ledger',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getOrganizationLedgerHandler
  );
  // Transaction Receipt (Member self, President/Treasurer same-mandal):
  app.get(
    '/api/transactions/:transactionId/receipt',
    requireAuth,
    getTransactionReceiptHandler
  );
  // Mandal Financial Summary (President & Treasurer Only):
  app.get(
    '/api/ledger/mandal-summary',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getMandalFinancialSummaryHandler
  );
  app.get(
    '/api/expenses/financial-summary',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getMandalFinancialSummaryHandler
  );
  // Record Vargani / Jama Contribution (President & Treasurer Only):
  app.post(
    '/api/ledger/contributions',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ body: recordVarganiContributionSchema }),
    recordVarganiContributionHandler
  );

  // 12. Loans & Udhar Foundation Routes (सभासद कर्ज, रोख परतफेड व लेजर)
  // Create / Approve Loan (President & Treasurer):
  app.post(
    '/api/loans',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ body: createLoanSchema }),
    createLoanHandler
  );
  // Record Cash Loan Repayment (President & Treasurer):
  app.post(
    '/api/loans/:loanId/repay-cash',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ body: recordLoanRepaymentSchema }),
    recordCashLoanRepaymentHandler
  );
  // Member loans (Self, President, or Treasurer):
  app.get('/api/loans/member/:memberId', requireAuth, getMemberLoansHandler);
  // Logged-in user's own loans:
  app.get('/api/loans/me', requireAuth, getMyLoansHandler);
  app.get('/api/loans/my-loans', requireAuth, getMyLoansHandler);
  // Mandal-wide loans list (President & Treasurer):
  app.get(
    '/api/loans',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getMandalLoansHandler
  );
  // Delete or Cancel Loan (President & Treasurer):
  app.delete(
    '/api/loans/:loanId',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    deleteLoanHandler
  );

  // 14. Expense Management Routes (President & Treasurer)
  app.get(
    '/api/expenses/categories',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getExpenseCategoriesHandler
  );
  app.post(
    '/api/expenses',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ body: createExpenseSchema }),
    createExpenseHandler
  );
  app.get(
    '/api/expenses',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getMandalExpensesHandler
  );
  app.get(
    '/api/expenses/:id',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getExpenseByIdHandler
  );
  app.delete(
    '/api/expenses/:id',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    deleteExpenseHandler
  );

  // 15. Financial Reporting & Audit Export Foundation Routes (President & Treasurer)
  app.get(
    '/api/reports/monthly-statement',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ query: monthlyStatementQuerySchema }),
    getMonthlyStatementHandler
  );
  app.get(
    '/api/reports/export-audit',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    validateRequest({ query: auditExportQuerySchema }),
    exportAuditCsvHandler
  );

  // 16. Online Payment & UPI Gateway Routes
  // Mandal payment configuration (President & Treasurer read, President edit)
  app.get(
    '/api/payments/config',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    getPaymentConfigHandler
  );
  app.post(
    '/api/payments/config',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    validateRequest({ body: upsertPaymentConfigSchema }),
    upsertPaymentConfigHandler
  );
  app.patch(
    '/api/payments/config/status',
    requireAuth,
    requireRole([ROLES.PRESIDENT]),
    validateRequest({ body: updatePaymentConfigStatusSchema }),
    updatePaymentConfigStatusHandler
  );
  // List payment orders (Authenticated: President/Treasurer all Mandal orders, Member own orders)
  app.get(
    '/api/payments/orders',
    requireAuth,
    getPaymentOrdersHandler
  );
  // Create payment order (Authenticated Member)
  app.post(
    '/api/payments/orders',
    requireAuth,
    validateRequest({ body: createPaymentOrderSchema }),
    createPaymentOrderHandler
  );
  // Server-side payment verification (Authenticated Member)
  app.post(
    '/api/payments/verify',
    requireAuth,
    validateRequest({ body: verifyPaymentSchema }),
    verifyPaymentHandler
  );
  // Order status polling (Authenticated Member, President, Treasurer)
  app.get(
    '/api/payments/orders/:orderId/status',
    requireAuth,
    getOrderStatusHandler
  );
  // Webhook endpoint (Public, server-to-server HMAC verified)
  app.post('/api/payments/webhook', webhookHandler);

  // 12. Notification Routes (In-App + Device Push Architecture)
  app.get(
    '/api/notifications',
    requireAuth,
    validateRequest({ query: getNotificationsQuerySchema }),
    getNotificationsHandler
  );
  app.get(
    '/api/notifications/unread-count',
    requireAuth,
    getUnreadCountHandler
  );
  app.patch(
    '/api/notifications/:id/read',
    requireAuth,
    markAsReadHandler
  );
  app.post(
    '/api/notifications/mark-all-read',
    requireAuth,
    markAllAsReadHandler
  );
  app.post(
    '/api/notifications/read-all',
    requireAuth,
    markAllAsReadHandler
  );
  app.post(
    '/api/notifications/device-token',
    requireAuth,
    validateRequest({ body: registerDeviceTokenSchema }),
    registerDeviceTokenHandler
  );
  app.delete(
    '/api/notifications/device-token',
    requireAuth,
    validateRequest({ body: unregisterDeviceTokenSchema }),
    unregisterDeviceTokenHandler
  );
  app.post(
    '/api/notifications/scheduler/run',
    requireAuth,
    requireRole([ROLES.PRESIDENT, ROLES.TREASURER]),
    runSchedulerHandler
  );

  // 13. Core Role-Based Access Verification Routes (Server-side RBAC)
  // President Only:
  app.get('/api/protected/president-only', requireAuth, requireRole([ROLES.PRESIDENT]), (req, res) => {
    res.json({
      success: true,
      message: 'अध्यक्ष अधिकार पडताळणी यशस्वी (President role authorized)',
      user: req.user,
    });
  });

  // Treasurer or President:
  app.get('/api/protected/treasurer-or-president', requireAuth, requireRole([ROLES.PRESIDENT, ROLES.TREASURER]), (req, res) => {
    res.json({
      success: true,
      message: 'खजिनदार / अध्यक्ष अधिकार पडताळणी यशस्वी (Treasurer/President authorized)',
      user: req.user,
    });
  });

  // All Mandal Members (Member, Treasurer, President):
  app.get('/api/protected/member-area', requireAuth, requireRole([ROLES.MEMBER, ROLES.TREASURER, ROLES.PRESIDENT]), (req, res) => {
    res.json({
      success: true,
      message: 'मंडळ सदस्य कक्ष पडताळणी यशस्वी (Mandal member area authorized)',
      user: req.user,
    });
  });

  // 10. 404 Route Handler
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: 'मागणी केलेला मार्ग उपलब्ध नाही (API route not found)',
    });
  });

  // 11. Central Error Handling Middleware
  app.use(errorHandler);

  return app;
}
