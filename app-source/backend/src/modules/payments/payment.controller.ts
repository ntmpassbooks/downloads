import { Request, Response, NextFunction } from 'express';
import { PaymentService } from './payment.service.js';
import {
  CreatePaymentOrderInput,
  UpdatePaymentConfigStatusInput,
  UpsertPaymentConfigInput,
  VerifyPaymentInput,
} from './payment.validation.js';

export function getPaymentConfigHandler(req: Request, res: Response): void {
  const actor = req.user!;
  const config = PaymentService.getPaymentConfig(actor.organizationId, actor.role);

  res.status(200).json({
    success: true,
    data: config,
  });
}

export function upsertPaymentConfigHandler(
  req: Request<{}, {}, UpsertPaymentConfigInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const config = PaymentService.upsertPaymentConfig(
    actor.organizationId,
    actor.id,
    req.body,
    ipAddress
  );

  res.status(200).json({
    success: true,
    message: 'पेमेंट रचना यशस्वीरीत्या जतन झाली (Payment config saved successfully)',
    data: config,
  });
}

export function updatePaymentConfigStatusHandler(
  req: Request<{}, {}, UpdatePaymentConfigStatusInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const config = PaymentService.updatePaymentConfigStatus(
    actor.organizationId,
    actor.id,
    req.body.status,
    ipAddress
  );

  res.status(200).json({
    success: true,
    message: 'पेमेंट स्थिती यशस्वीरीत्या बदलली (Payment status updated)',
    data: config,
  });
}

export async function createPaymentOrderHandler(
  req: Request<{}, {}, CreatePaymentOrderInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

    const result = await PaymentService.createPaymentOrder(
      actor.organizationId,
      actor.id,
      req.body.bishiRecordId,
      ipAddress
    );

    res.status(201).json({
      success: true,
      message: 'पेमेंट ऑर्डर तयार झाली (Payment order created)',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyPaymentHandler(
  req: Request<{}, {}, VerifyPaymentInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = req.user!;
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

    const result = await PaymentService.verifyPaymentAndFinalize(
      actor.organizationId,
      actor.id,
      req.body,
      ipAddress
    );

    res.status(200).json({
      success: true,
      message: 'पेमेंट पडताळणी यशस्वी! बीसी जमा नोंद झाली. (Payment verified and recorded)',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function webhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    const result = await PaymentService.handleWebhook(rawBody, req.headers, ipAddress);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export function getOrderStatusHandler(
  req: Request<{ orderId: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { orderId } = req.params;

  const order = PaymentService.getOrderStatus(actor.organizationId, orderId, actor);

  res.status(200).json({
    success: true,
    data: order,
  });
}

export function getPaymentOrdersHandler(req: Request, res: Response): void {
  const actor = req.user!;
  const orders = PaymentService.listPaymentOrders(actor.organizationId, actor);

  res.status(200).json({
    success: true,
    data: orders,
  });
}

