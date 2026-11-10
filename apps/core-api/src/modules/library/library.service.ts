import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import { daysBetween, newId, toIso, toMoney } from "../hostel/hostel.common";
import { Actor, audit } from "../identity/identity.service";
import { amount, date, fail, inTx, oneOf, text, todayBd, whole } from "../academics/academics.common";

const shiftDate = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// ---- Settings ---------------------------------------------------------------------

const DEFAULTS = { loan_days: 14, fine_per_day: 5, max_loans: 3, max_renewals: 1 };

const settingsOf = async (db: PoolClient | typeof postgresService, institutionId: string) => {
  const { rows } = await db.query("SELECT * FROM lib_settings WHERE institution_id = $1", [institutionId]);
  const row = rows[0] || DEFAULTS;
  return { loanDays: Number(row.loan_days), finePerDay: toMoney(row.fine_per_day), maxLoans: Number(row.max_loans), maxRenewals: Number(row.max_renewals) };
};

// ---- Books ------------------------------------------------------------------------

const bookFromRow = (row: any) => ({
  id: row.id,
  isbn: row.isbn,
  title: row.title,
  author: row.author,
  publisher: row.publisher,
  category: row.category,
  edition: row.edition,
  shelf: row.shelf,
  totalCopies: Number(row.total_copies),
  onLoan: Number(row.on_loan ?? 0),
  available: Number(row.total_copies) - Number(row.on_loan ?? 0),
  createdAt: toIso(row.created_at),
});

const BOOK_SELECT = `SELECT b.*, (SELECT COUNT(*) FROM lib_loans l WHERE l.book_id = b.id AND l.returned_on IS NULL) AS on_loan FROM lib_books b`;

const bookInput = (body: any, existing?: any) => {
  const pick = (key: string, column: string, label: string, max: number, required = false) =>
    body?.[key] !== undefined || !existing ? text(body?.[key], label, max, required) : existing[column];
  const isbn = pick("isbn", "isbn", "ISBN", 20).replace(/[\s-]/g, "");
  if (isbn && !/^(\d{9}[\dX]|\d{13})$/i.test(isbn)) fail(400, "ISBN must have 10 or 13 digits.");
  return {
    isbn: isbn.toUpperCase(),
    title: pick("title", "title", "Title", 250, true),
    author: pick("author", "author", "Author", 200),
    publisher: pick("publisher", "publisher", "Publisher", 200),
    category: pick("category", "category", "Category", 100),
    edition: pick("edition", "edition", "Edition", 50),
    shelf: pick("shelf", "shelf", "Shelf", 50),
    totalCopies: body?.totalCopies !== undefined || !existing ? whole(body?.totalCopies ?? 1, "Copies", 0, 10000) : Number(existing.total_copies),
  };
};

export const booksService = {
  async list(institutionId: string, filters: { search?: string; category?: string } = {}) {
    const { rows } = await postgresService.query(
      `${BOOK_SELECT} WHERE b.institution_id = $1
         AND ($2 = '' OR b.title ILIKE '%' || $2 || '%' OR b.author ILIKE '%' || $2 || '%' OR b.isbn ILIKE '%' || $2 || '%')
         AND ($3 = '' OR b.category = $3)
       ORDER BY b.title LIMIT 1000`,
      [institutionId, filters.search?.trim() || "", filters.category || ""]
    );
    return rows.map(bookFromRow);
  },

  async create(actor: Actor, body: any) {
    const data = bookInput(body);
    const id = newId();
    await inTx(async (tx) => {
      await tx.query(
        `INSERT INTO lib_books (id, institution_id, isbn, title, author, publisher, category, edition, shelf, total_copies)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, actor.institutionId, data.isbn, data.title, data.author, data.publisher, data.category, data.edition, data.shelf, data.totalCopies]
      );
      await audit(tx, actor, "library.book.create", "book", id, `Added "${data.title}" (${data.totalCopies} copies).`);
    });
    return this.get(actor.institutionId, id);
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${BOOK_SELECT} WHERE b.institution_id = $1 AND b.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Book not found.");
    return bookFromRow(rows[0]);
  },

  async update(actor: Actor, id: string, body: any) {
    await inTx(async (tx) => {
      const { rows } = await tx.query(`${BOOK_SELECT} WHERE b.institution_id = $1 AND b.id = $2 FOR UPDATE OF b`, [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Book not found.");
      const data = bookInput(body, rows[0]);
      if (data.totalCopies < Number(rows[0].on_loan)) fail(409, `${rows[0].on_loan} copies are on loan, so there cannot be fewer copies than that.`);
      await tx.query(
        `UPDATE lib_books SET isbn = $3, title = $4, author = $5, publisher = $6, category = $7, edition = $8, shelf = $9, total_copies = $10
         WHERE institution_id = $1 AND id = $2`,
        [actor.institutionId, id, data.isbn, data.title, data.author, data.publisher, data.category, data.edition, data.shelf, data.totalCopies]
      );
      await audit(tx, actor, "library.book.update", "book", id, `Edited "${data.title}".`);
    });
    return this.get(actor.institutionId, id);
  },

  async remove(actor: Actor, id: string) {
    return inTx(async (tx) => {
      const { rows } = await tx.query("SELECT title FROM lib_books WHERE institution_id = $1 AND id = $2", [actor.institutionId, id]);
      if (!rows[0]) fail(404, "Book not found.");
      const loans = await tx.query("SELECT 1 FROM lib_loans WHERE book_id = $1 LIMIT 1", [id]);
      if (loans.rows[0]) fail(409, "This book has loan history. Set its copies to 0 instead of deleting it.");
      await tx.query("DELETE FROM lib_books WHERE id = $1", [id]);
      await audit(tx, actor, "library.book.delete", "book", id, `Deleted "${rows[0].title}".`);
      return { id };
    });
  },
};

// ---- Loans ------------------------------------------------------------------------

const loanFromRow = (row: any, today = todayBd(), finePerDay = 0) => {
  const open = !row.returned_on;
  const lateDays = Math.max(0, daysBetween(row.due_on, row.returned_on || today));
  return {
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    isbn: row.isbn,
    borrowerType: row.borrower_type,
    borrowerId: row.borrower_id,
    borrowerNo: row.borrower_no,
    borrowerName: row.borrower_name,
    issuedOn: row.issued_on,
    dueOn: row.due_on,
    renewals: Number(row.renewals),
    returnedOn: row.returned_on,
    state: open ? (lateDays > 0 ? "OVERDUE" : "ON_LOAN") : "RETURNED",
    lateDays,
    // While a book is out, the fine so far is an estimate; it is fixed when the book comes back.
    fineAmount: open ? Math.round(lateDays * finePerDay * 100) / 100 : toMoney(row.fine_amount),
    fineStatus: open ? (lateDays > 0 ? "ACCRUING" : "NONE") : row.fine_status,
    fineNote: row.fine_note,
    issuedBy: row.issued_by,
    returnedBy: row.returned_by,
  };
};

const LOAN_SELECT = `SELECT l.*, b.title AS book_title, b.isbn FROM lib_loans l JOIN lib_books b ON b.id = l.book_id`;

// Finds a student or teacher by their ID number or record id.
const findBorrower = async (tx: PoolClient, institutionId: string, type: "STUDENT" | "TEACHER", who: string) => {
  const sql = type === "STUDENT"
    ? "SELECT id, student_no AS no, full_name, status FROM acad_students WHERE institution_id = $1 AND (id = $2 OR LOWER(student_no) = LOWER($2))"
    : "SELECT id, employee_no AS no, full_name, status FROM acad_teachers WHERE institution_id = $1 AND (id = $2 OR LOWER(employee_no) = LOWER($2))";
  const { rows } = await tx.query(sql, [institutionId, who]);
  if (!rows[0]) fail(400, `No ${type.toLowerCase()} has that ID.`);
  if (rows[0].status !== "ACTIVE") fail(409, `This ${type.toLowerCase()} is not active.`);
  return rows[0];
};

export const loansService = {
  settings: (institutionId: string) => settingsOf(postgresService, institutionId),

  async saveSettings(actor: Actor, body: any) {
    const current = await settingsOf(postgresService, actor.institutionId);
    const next = {
      loanDays: body?.loanDays !== undefined ? whole(body.loanDays, "Loan days", 1, 365) : current.loanDays,
      finePerDay: body?.finePerDay !== undefined ? amount(body.finePerDay, "Fine per day", 0, 10000) : current.finePerDay,
      maxLoans: body?.maxLoans !== undefined ? whole(body.maxLoans, "Books per borrower", 1, 50) : current.maxLoans,
      maxRenewals: body?.maxRenewals !== undefined ? whole(body.maxRenewals, "Renewals", 0, 10) : current.maxRenewals,
    };
    await postgresService.query(
      `INSERT INTO lib_settings (institution_id, loan_days, fine_per_day, max_loans, max_renewals) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (institution_id) DO UPDATE SET loan_days = $2, fine_per_day = $3, max_loans = $4, max_renewals = $5`,
      [actor.institutionId, next.loanDays, next.finePerDay, next.maxLoans, next.maxRenewals]
    );
    await audit(postgresService, actor, "library.settings", "library", actor.institutionId, `Loans ${next.loanDays} days, fine ${next.finePerDay}/day, ${next.maxLoans} books, ${next.maxRenewals} renewals.`);
    return next;
  },

  async list(institutionId: string, filters: { state?: string; search?: string; borrowerType?: string; borrowerId?: string } = {}) {
    const today = todayBd();
    const state = filters.state || "";
    const { rows } = await postgresService.query(
      `${LOAN_SELECT} WHERE l.institution_id = $1
         AND ($2 = '' OR ($2 = 'OPEN' AND l.returned_on IS NULL) OR ($2 = 'OVERDUE' AND l.returned_on IS NULL AND l.due_on < $3::date)
              OR ($2 = 'RETURNED' AND l.returned_on IS NOT NULL) OR ($2 = 'FINES' AND l.fine_status = 'DUE'))
         AND ($4 = '' OR l.borrower_name ILIKE '%' || $4 || '%' OR l.borrower_no ILIKE '%' || $4 || '%' OR b.title ILIKE '%' || $4 || '%')
         AND ($5 = '' OR l.borrower_type = $5) AND ($6 = '' OR l.borrower_id = $6)
       ORDER BY (l.returned_on IS NULL) DESC, l.due_on, l.created_at DESC LIMIT 500`,
      [institutionId, state, today, filters.search?.trim() || "", filters.borrowerType || "", filters.borrowerId || ""]
    );
    const { finePerDay } = await settingsOf(postgresService, institutionId);
    return rows.map((row: any) => loanFromRow(row, today, finePerDay));
  },

  async get(institutionId: string, id: string) {
    const { rows } = await postgresService.query(`${LOAN_SELECT} WHERE l.institution_id = $1 AND l.id = $2`, [institutionId, id]);
    if (!rows[0]) fail(404, "Loan not found.");
    const { finePerDay } = await settingsOf(postgresService, institutionId);
    return loanFromRow(rows[0], todayBd(), finePerDay);
  },

  // Lends one copy. The book row is locked so two desks cannot lend the last copy twice.
  async issue(actor: Actor, body: any) {
    const type = oneOf(body?.borrowerType, "Borrower type", ["STUDENT", "TEACHER"] as const);
    const who = text(body?.borrower, "Borrower ID", 64, true);
    const id = await inTx(async (tx) => {
      const settings = await settingsOf(tx, actor.institutionId);
      const book = (await tx.query("SELECT * FROM lib_books WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, body?.bookId])).rows[0];
      if (!book) fail(404, "Book not found.");
      const out = Number((await tx.query("SELECT COUNT(*) AS n FROM lib_loans WHERE book_id = $1 AND returned_on IS NULL", [book.id])).rows[0].n);
      if (out >= Number(book.total_copies)) fail(409, "No copies of this book are available.");
      const borrower = await findBorrower(tx, actor.institutionId, type, who);
      const mine = (await tx.query(
        `SELECT COUNT(*) FILTER (WHERE returned_on IS NULL) AS open, COUNT(*) FILTER (WHERE returned_on IS NULL AND due_on < $4::date) AS overdue,
           COUNT(*) FILTER (WHERE fine_status = 'DUE') AS fines
         FROM lib_loans WHERE institution_id = $1 AND borrower_type = $2 AND borrower_id = $3`,
        [actor.institutionId, type, borrower.id, todayBd()]
      )).rows[0];
      if (Number(mine.overdue) > 0) fail(409, "This borrower has an overdue book. Return it first.");
      if (Number(mine.fines) > 0) fail(409, "This borrower has an unpaid library fine.");
      if (Number(mine.open) >= settings.maxLoans) fail(409, `This borrower already has ${mine.open} books, the most allowed.`);
      const issuedOn = todayBd();
      const dueOn = date(body?.dueOn, "Due date") || shiftDate(issuedOn, settings.loanDays);
      if (dueOn <= issuedOn) fail(400, "The due date must be after today.");
      const loanId = newId();
      await tx.query(
        `INSERT INTO lib_loans (id, institution_id, book_id, borrower_type, borrower_id, borrower_no, borrower_name, issued_on, due_on, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [loanId, actor.institutionId, book.id, type, borrower.id, borrower.no, borrower.full_name, issuedOn, dueOn, actor.email]
      );
      await audit(tx, actor, "library.loan.issue", "loan", loanId, `Lent "${book.title}" to ${borrower.no} until ${dueOn}.`);
      return loanId;
    });
    return this.get(actor.institutionId, id);
  },

  async renew(actor: Actor, id: string) {
    await inTx(async (tx) => {
      const settings = await settingsOf(tx, actor.institutionId);
      const loan = (await tx.query("SELECT * FROM lib_loans WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!loan) fail(404, "Loan not found.");
      if (loan.returned_on) fail(409, "This book is already returned.");
      if (loan.due_on < todayBd()) fail(409, "An overdue book cannot be renewed. Return it and settle the fine.");
      if (Number(loan.renewals) >= settings.maxRenewals) fail(409, "This loan cannot be renewed again.");
      const dueOn = shiftDate(loan.due_on, settings.loanDays);
      await tx.query("UPDATE lib_loans SET due_on = $2, renewals = renewals + 1 WHERE id = $1", [id, dueOn]);
      await audit(tx, actor, "library.loan.renew", "loan", id, `Renewed loan for ${loan.borrower_no} until ${dueOn}.`);
    });
    return this.get(actor.institutionId, id);
  },

  // Takes a book back and fixes the fine at the day rate in force now.
  async giveBack(actor: Actor, id: string) {
    await inTx(async (tx) => {
      const settings = await settingsOf(tx, actor.institutionId);
      const loan = (await tx.query("SELECT * FROM lib_loans WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!loan) fail(404, "Loan not found.");
      if (loan.returned_on) fail(409, "This book is already returned.");
      const today = todayBd();
      const fine = Math.round(Math.max(0, daysBetween(loan.due_on, today)) * settings.finePerDay * 100) / 100;
      await tx.query("UPDATE lib_loans SET returned_on = $2, returned_by = $3, fine_amount = $4, fine_status = $5 WHERE id = $1",
        [id, today, actor.email, fine, fine > 0 ? "DUE" : "NONE"]);
      await audit(tx, actor, "library.loan.return", "loan", id, `Returned by ${loan.borrower_no}.${fine > 0 ? ` Fine ${fine}.` : ""}`);
    });
    return this.get(actor.institutionId, id);
  },

  // A fine is settled once: paid at the desk, or waived with a reason.
  async settleFine(actor: Actor, id: string, body: any) {
    const action = oneOf(body?.action, "Action", ["PAID", "WAIVED"] as const);
    const note = text(body?.note, "Note", 500, action === "WAIVED");
    await inTx(async (tx) => {
      const loan = (await tx.query("SELECT * FROM lib_loans WHERE institution_id = $1 AND id = $2 FOR UPDATE", [actor.institutionId, id])).rows[0];
      if (!loan) fail(404, "Loan not found.");
      if (loan.fine_status !== "DUE") fail(409, "There is no unpaid fine on this loan.");
      await tx.query("UPDATE lib_loans SET fine_status = $2, fine_settled_by = $3, fine_note = $4 WHERE id = $1", [id, action, actor.email, note]);
      await audit(tx, actor, `library.fine.${action.toLowerCase()}`, "loan", id, `Fine ${toMoney(loan.fine_amount)} of ${loan.borrower_no} ${action.toLowerCase()}.${note ? ` ${note}` : ""}`);
    });
    return this.get(actor.institutionId, id);
  },

  async summary(institutionId: string) {
    const today = todayBd();
    const { rows } = await postgresService.query(
      `SELECT (SELECT COUNT(*) FROM lib_books WHERE institution_id = $1) AS titles,
         (SELECT COALESCE(SUM(total_copies), 0) FROM lib_books WHERE institution_id = $1) AS copies,
         COUNT(*) FILTER (WHERE returned_on IS NULL) AS on_loan,
         COUNT(*) FILTER (WHERE returned_on IS NULL AND due_on < $2::date) AS overdue,
         COALESCE(SUM(fine_amount) FILTER (WHERE fine_status = 'DUE'), 0) AS fines_due,
         COALESCE(SUM(fine_amount) FILTER (WHERE fine_status = 'PAID'), 0) AS fines_paid
       FROM lib_loans WHERE institution_id = $1`,
      [institutionId, today]
    );
    const row = rows[0];
    return { titles: Number(row.titles), copies: Number(row.copies), onLoan: Number(row.on_loan), overdue: Number(row.overdue), finesDue: toMoney(row.fines_due), finesPaid: toMoney(row.fines_paid) };
  },

  // A student's or teacher's own loans, by their ID number.
  async ofPerson(institutionId: string, type: "STUDENT" | "TEACHER", number: string) {
    const table = type === "STUDENT" ? "acad_students WHERE institution_id = $1 AND LOWER(student_no) = LOWER($2)" : "acad_teachers WHERE institution_id = $1 AND LOWER(employee_no) = LOWER($2)";
    const { rows } = await postgresService.query(`SELECT id FROM ${table}`, [institutionId, number]);
    if (!rows[0]) return [];
    return this.list(institutionId, { borrowerType: type, borrowerId: rows[0].id });
  },
};
