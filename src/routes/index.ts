import { Router } from "express";
import { getFinancials } from "../contollers/financials";

const router = Router();

// GET /api/financials?ticker=AAPL
// GET /api/financials?ticker=AAPL&formType=10-Q
router.get("/financials", getFinancials);

export default router;
