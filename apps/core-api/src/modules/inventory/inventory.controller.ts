import { Request, Router } from "express";
import { hasPermissionKey, requirePermissionKey } from "../../middleware/auth.middleware";
import { route, send } from "../hostel/hostel.common";
import { actorOf } from "../identity/identity.controller";
import { assetsService, batchesService, insightsService, itemsService, stockService, storesService, transfersService } from "./inventory.service";
import { purchaseOrdersService, suppliersService } from "./inventory-purchase.service";
import { alertSettingsService, sendAlertDigest } from "./inventory-alerts.service";
import { requisitionsService } from "./inventory-requisitions.service";
import { consumptionService } from "./inventory-kitchen.service";
import { roomsService } from "./inventory-rooms.service";
import { reportsService } from "./inventory-reports.service";

export const inventoryRouter = Router();

const query = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");
const tenant = (req: Request) => req.institutionId as string;

const canRead = requirePermissionKey("inventory.read");
const canCreate = requirePermissionKey("inventory.create");
const canEdit = requirePermissionKey("inventory.update");
const canDelete = requirePermissionKey("inventory.delete");
const canApprove = requirePermissionKey("inventory.approve");
// Receiving, issuing and taking back stock is the store desk's daily work.
const canMoveStock = requirePermissionKey("inventory.manage_stock");
// Counts and write-offs change the books without goods changing hands, so they are kept apart.
const canAdjust = requirePermissionKey("inventory.adjust_stock");
const canTransfer = requirePermissionKey("inventory.transfer_stock", "inventory.approve");
const canHandleAssets = requirePermissionKey("inventory.manage_assets");

// Dashboard, alerts and reports
inventoryRouter.get("/inventory/summary", canRead, route(async (req, res) => send(res, 200, await insightsService.summary(tenant(req)))));
inventoryRouter.get("/inventory/alerts", canRead, route(async (req, res) => send(res, 200, await insightsService.alerts(tenant(req)))));
inventoryRouter.get("/inventory/movement-analysis", canRead, route(async (req, res) => {
  const days = Math.min(365, Math.max(7, Number(query(req, "days")) || 90));
  send(res, 200, { days, items: await insightsService.movement(tenant(req), days) });
}));
inventoryRouter.get("/inventory/categories", canRead, route(async (req, res) => send(res, 200, await itemsService.categories(tenant(req)))));
inventoryRouter.get("/inventory/lookup", canRead, route(async (req, res) => send(res, 200, await itemsService.lookup(tenant(req), query(req, "code")))));

// Stores
inventoryRouter.get("/inventory/stores", canRead, route(async (req, res) => send(res, 200, await storesService.list(tenant(req)))));
inventoryRouter.post("/inventory/stores", canCreate, route(async (req, res) => send(res, 201, await storesService.create(actorOf(req), req.body))));
inventoryRouter.put("/inventory/stores/:id", canEdit, route(async (req, res) => send(res, 200, await storesService.update(actorOf(req), req.params.id, req.body))));
inventoryRouter.delete("/inventory/stores/:id", canDelete, route(async (req, res) => send(res, 200, await storesService.remove(actorOf(req), req.params.id))));

// Items
inventoryRouter.get("/inventory/items", canRead, route(async (req, res) => {
  send(res, 200, await itemsService.list(tenant(req), { search: query(req, "search"), category: query(req, "category"), status: query(req, "status"), stock: query(req, "stock") }));
}));
inventoryRouter.get("/inventory/items/:id", canRead, route(async (req, res) => send(res, 200, await itemsService.get(tenant(req), req.params.id))));
inventoryRouter.post("/inventory/items", canCreate, route(async (req, res) => {
  // Opening stock puts goods on the books, so it needs the stock permission as well.
  if (req.body?.openingQuantity && !hasPermissionKey(req, "inventory.manage_stock")) {
    res.status(403).json({ success: false, statusCode: 403, error: "Adding opening stock needs the permission to receive stock." });
    return;
  }
  send(res, 201, await itemsService.create(actorOf(req), req.body));
}));
inventoryRouter.post("/inventory/items/import", canCreate, route(async (req, res) => {
  const withStock = Array.isArray(req.body?.items) && req.body.items.some((row: any) => row?.openingQuantity);
  if (withStock && !hasPermissionKey(req, "inventory.manage_stock")) {
    res.status(403).json({ success: false, statusCode: 403, error: "Importing opening stock needs the permission to receive stock." });
    return;
  }
  send(res, 201, await itemsService.importMany(actorOf(req), req.body));
}));
inventoryRouter.put("/inventory/items/:id", canEdit, route(async (req, res) => send(res, 200, await itemsService.update(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/items/:id/archive", canEdit, route(async (req, res) => send(res, 200, await itemsService.setArchived(actorOf(req), req.params.id, true))));
inventoryRouter.post("/inventory/items/:id/restore", canEdit, route(async (req, res) => send(res, 200, await itemsService.setArchived(actorOf(req), req.params.id, false))));
inventoryRouter.delete("/inventory/items/:id", canDelete, route(async (req, res) => send(res, 200, await itemsService.remove(actorOf(req), req.params.id))));

// Stock ledger
inventoryRouter.get("/inventory/movements", canRead, route(async (req, res) => {
  send(res, 200, await stockService.movements(tenant(req), {
    itemId: query(req, "itemId"), storeId: query(req, "storeId"), kind: query(req, "kind"), from: query(req, "from"), to: query(req, "to"), search: query(req, "search"),
  }));
}));
inventoryRouter.get("/inventory/documents/:docNo", canRead, route(async (req, res) => send(res, 200, await stockService.document(tenant(req), req.params.docNo))));
inventoryRouter.post("/inventory/stock/receive", canMoveStock, route(async (req, res) => send(res, 201, await stockService.receive(actorOf(req), req.body))));
inventoryRouter.post("/inventory/stock/issue", canMoveStock, route(async (req, res) => send(res, 201, await stockService.issue(actorOf(req), req.body))));
inventoryRouter.post("/inventory/stock/return", canMoveStock, route(async (req, res) => send(res, 201, await stockService.takeBack(actorOf(req), req.body))));
inventoryRouter.post("/inventory/stock/count", canAdjust, route(async (req, res) => send(res, 201, await stockService.count(actorOf(req), req.body))));
inventoryRouter.post("/inventory/stock/write-off", canAdjust, route(async (req, res) => send(res, 201, await stockService.writeOff(actorOf(req), req.body))));
// Undoing a posted entry is a correction of the books, so it needs approval rights.
inventoryRouter.post("/inventory/movements/:id/reverse", canApprove, route(async (req, res) => send(res, 201, await stockService.reverse(actorOf(req), req.params.id, req.body))));

// Transfers
inventoryRouter.get("/inventory/transfers", canRead, route(async (req, res) => send(res, 200, await transfersService.list(tenant(req), { status: query(req, "status") }))));
inventoryRouter.get("/inventory/transfers/:id", canRead, route(async (req, res) => send(res, 200, await transfersService.get(tenant(req), req.params.id))));
inventoryRouter.post("/inventory/transfers", canTransfer, route(async (req, res) => send(res, 201, await transfersService.request(actorOf(req), req.body))));
inventoryRouter.post("/inventory/transfers/:id/approve", canApprove, route(async (req, res) => send(res, 200, await transfersService.approve(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/transfers/:id/reject", canApprove, route(async (req, res) => send(res, 200, await transfersService.close(actorOf(req), req.params.id, "REJECTED", req.body, true))));
inventoryRouter.post("/inventory/transfers/:id/cancel", canTransfer, route(async (req, res) => {
  send(res, 200, await transfersService.close(actorOf(req), req.params.id, "CANCELLED", req.body, hasPermissionKey(req, "inventory.approve")));
}));
inventoryRouter.post("/inventory/transfers/:id/receive", canTransfer, route(async (req, res) => send(res, 200, await transfersService.receive(actorOf(req), req.params.id))));

// Batches and expiry
inventoryRouter.get("/inventory/batches", canRead, route(async (req, res) => {
  send(res, 200, await batchesService.list(tenant(req), { itemId: query(req, "itemId"), storeId: query(req, "storeId"), state: query(req, "state") }));
}));

// Alert settings and the alert email
inventoryRouter.get("/inventory/settings", canRead, route(async (req, res) => send(res, 200, await alertSettingsService.get(tenant(req)))));
inventoryRouter.put("/inventory/settings", canEdit, route(async (req, res) => send(res, 200, await alertSettingsService.save(actorOf(req), req.body))));
inventoryRouter.get("/inventory/alerts/email-log", canRead, route(async (req, res) => send(res, 200, await alertSettingsService.log(tenant(req)))));
inventoryRouter.post("/inventory/alerts/email", canEdit, route(async (req, res) => send(res, 200, await sendAlertDigest(tenant(req), actorOf(req).email, { force: true }))));

// Suppliers and purchase orders
const canPurchase = requirePermissionKey("inventory.manage_purchases");
inventoryRouter.get("/inventory/suppliers", canRead, route(async (req, res) => send(res, 200, await suppliersService.list(tenant(req), { search: query(req, "search") }))));
inventoryRouter.post("/inventory/suppliers", canPurchase, route(async (req, res) => send(res, 201, await suppliersService.create(actorOf(req), req.body))));
inventoryRouter.put("/inventory/suppliers/:id", canPurchase, route(async (req, res) => send(res, 200, await suppliersService.update(actorOf(req), req.params.id, req.body))));
inventoryRouter.delete("/inventory/suppliers/:id", canDelete, route(async (req, res) => send(res, 200, await suppliersService.remove(actorOf(req), req.params.id))));
inventoryRouter.get("/inventory/purchase-orders", canRead, route(async (req, res) => {
  send(res, 200, await purchaseOrdersService.list(tenant(req), { status: query(req, "status"), supplierId: query(req, "supplierId"), search: query(req, "search") }));
}));
inventoryRouter.get("/inventory/purchase-orders/:id", canRead, route(async (req, res) => send(res, 200, await purchaseOrdersService.get(tenant(req), req.params.id))));
inventoryRouter.post("/inventory/purchase-orders", canPurchase, route(async (req, res) => send(res, 201, await purchaseOrdersService.create(actorOf(req), req.body))));
inventoryRouter.put("/inventory/purchase-orders/:id", canPurchase, route(async (req, res) => send(res, 200, await purchaseOrdersService.update(actorOf(req), req.params.id, req.body))));
inventoryRouter.delete("/inventory/purchase-orders/:id", canPurchase, route(async (req, res) => send(res, 200, await purchaseOrdersService.remove(actorOf(req), req.params.id))));
// Approving spends money, so it needs approval rights; receiving the goods is store work.
inventoryRouter.post("/inventory/purchase-orders/:id/approve", canApprove, route(async (req, res) => send(res, 200, await purchaseOrdersService.approve(actorOf(req), req.params.id))));
inventoryRouter.post("/inventory/purchase-orders/:id/receive", canMoveStock, route(async (req, res) => send(res, 201, await purchaseOrdersService.receive(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/purchase-orders/:id/close", canApprove, route(async (req, res) => send(res, 200, await purchaseOrdersService.close(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/purchase-orders/:id/cancel", canApprove, route(async (req, res) => send(res, 200, await purchaseOrdersService.cancel(actorOf(req), req.params.id, req.body))));

// Assets
inventoryRouter.get("/inventory/assets", canRead, route(async (req, res) => {
  send(res, 200, await assetsService.list(tenant(req), { search: query(req, "search"), status: query(req, "status"), category: query(req, "category"), storeId: query(req, "storeId"), roomId: query(req, "roomId") }));
}));
inventoryRouter.get("/inventory/assets/:id", canRead, route(async (req, res) => send(res, 200, await assetsService.get(tenant(req), req.params.id))));
inventoryRouter.post("/inventory/assets", canCreate, route(async (req, res) => send(res, 201, await assetsService.create(actorOf(req), req.body))));
inventoryRouter.put("/inventory/assets/:id", canEdit, route(async (req, res) => send(res, 200, await assetsService.update(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/assets/:id/action", canHandleAssets, route(async (req, res) => {
  // Writing an asset off the books is a decision, not desk work.
  if (req.body?.action === "DISPOSE" && !hasPermissionKey(req, "inventory.approve")) {
    res.status(403).json({ success: false, statusCode: 403, error: "Disposing of an asset needs the inventory approve permission." });
    return;
  }
  send(res, 200, await assetsService.act(actorOf(req), req.params.id, req.body));
}));
inventoryRouter.delete("/inventory/assets/:id", canDelete, route(async (req, res) => send(res, 200, await assetsService.remove(actorOf(req), req.params.id))));
// Stock taken out of a store and registered unit by unit as assets, in rooms or places.
inventoryRouter.post("/inventory/assets/from-stock", canMoveStock, route(async (req, res) => send(res, 201, await roomsService.fromStock(actorOf(req), req.body))));
inventoryRouter.get("/inventory/rooms", canRead, route(async (req, res) => send(res, 200, await roomsService.list(tenant(req)))));

// Organisation setup: which parts of inventory are in use
inventoryRouter.put("/inventory/setup", canEdit, route(async (req, res) => send(res, 200, await alertSettingsService.saveSetup(actorOf(req), req.body))));

// Requisitions. Anyone allowed to raise one sees their own; the store and approvers see all.
const canRequest = requirePermissionKey("inventory.request_items", "inventory.read");
inventoryRouter.get("/inventory/requisitions", canRequest, route(async (req, res) => {
  send(res, 200, await requisitionsService.list(actorOf(req), { status: query(req, "status"), mine: query(req, "mine") === "1", search: query(req, "search") }));
}));
inventoryRouter.get("/inventory/requisitions/catalog", canRequest, route(async (req, res) => send(res, 200, await requisitionsService.catalog(tenant(req)))));
inventoryRouter.get("/inventory/requisitions/:id", canRequest, route(async (req, res) => send(res, 200, await requisitionsService.get(actorOf(req), req.params.id))));
inventoryRouter.post("/inventory/requisitions", requirePermissionKey("inventory.request_items"), route(async (req, res) => send(res, 201, await requisitionsService.create(actorOf(req), req.body))));
inventoryRouter.post("/inventory/requisitions/:id/approve", canApprove, route(async (req, res) => send(res, 200, await requisitionsService.approve(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/requisitions/:id/reject", canApprove, route(async (req, res) => send(res, 200, await requisitionsService.reject(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/requisitions/:id/close", canApprove, route(async (req, res) => send(res, 200, await requisitionsService.close(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/requisitions/:id/issue", canMoveStock, route(async (req, res) => send(res, 201, await requisitionsService.issue(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/requisitions/:id/cancel", canRequest, route(async (req, res) => send(res, 200, await requisitionsService.cancel(actorOf(req), req.params.id, req.body))));
inventoryRouter.post("/inventory/requisitions/:id/receive", canRequest, route(async (req, res) => send(res, 200, await requisitionsService.confirm(actorOf(req), req.params.id, req.body))));

// Consumption, wastage and the kitchen day sheet
const canConsume = requirePermissionKey("inventory.manage_kitchen", "inventory.manage_stock");
inventoryRouter.post("/inventory/consumption", canConsume, route(async (req, res) => send(res, 201, await consumptionService.consume(actorOf(req), req.body))));
inventoryRouter.post("/inventory/wastage", canConsume, route(async (req, res) => send(res, 201, await consumptionService.waste(actorOf(req), req.body))));
inventoryRouter.put("/inventory/kitchen/meal-count", canConsume, route(async (req, res) => send(res, 200, await consumptionService.setMealCount(actorOf(req), req.body))));
inventoryRouter.get("/inventory/kitchen/day", canRead, route(async (req, res) => send(res, 200, await consumptionService.day(tenant(req), query(req, "storeId"), query(req, "date")))));
inventoryRouter.get("/inventory/kitchen/month", canRead, route(async (req, res) => send(res, 200, await consumptionService.month(tenant(req), query(req, "storeId"), { month: query(req, "month"), from: query(req, "from"), to: query(req, "to") }))));

// Spending by purpose and reorder suggestions
inventoryRouter.get("/inventory/reports/expenses", canRead, route(async (req, res) => send(res, 200, await reportsService.expenses(tenant(req), { from: query(req, "from"), to: query(req, "to") }))));
inventoryRouter.get("/inventory/reports/reorder", canRead, route(async (req, res) => send(res, 200, await reportsService.reorder(tenant(req), query(req, "days")))));
