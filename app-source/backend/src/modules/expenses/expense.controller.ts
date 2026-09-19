import { Request, Response } from 'express';
import { ExpenseService } from './expense.service.js';
import { CreateExpenseInput, ExpenseCategory, EXPENSE_CATEGORIES } from './expense.types.js';

export function createExpenseHandler(
  req: Request<{}, {}, CreateExpenseInput>,
  res: Response
): void {
  const actor = req.user!;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const expense = ExpenseService.createExpense(
    actor.organizationId,
    req.body,
    actor,
    ipAddress
  );

  res.status(201).json({
    success: true,
    message: 'खर्च अधिकृतरीत्या नोंदवला गेला आहे (Expense recorded successfully in ledger)',
    data: expense,
  });
}

export function getMandalExpensesHandler(req: Request, res: Response): void {
  const actor = req.user!;
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 20;
  const category = req.query.category as ExpenseCategory | undefined;

  const result = ExpenseService.getMandalExpenses(
    actor.organizationId,
    actor,
    page,
    limit,
    category
  );

  res.status(200).json({
    success: true,
    data: result,
  });
}

export function getExpenseByIdHandler(
  req: Request<{ id: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { id } = req.params;

  const expense = ExpenseService.getExpenseById(actor.organizationId, id, actor);

  res.status(200).json({
    success: true,
    data: expense,
  });
}

export function getExpenseCategoriesHandler(_req: Request, res: Response): void {
  res.status(200).json({
    success: true,
    data: EXPENSE_CATEGORIES,
  });
}

export function deleteExpenseHandler(
  req: Request<{ id: string }>,
  res: Response
): void {
  const actor = req.user!;
  const { id } = req.params;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || '';

  const result = ExpenseService.deleteExpense(actor.organizationId, id, actor, ipAddress);

  res.status(200).json({
    success: true,
    message: result.message,
    data: result,
  });
}
