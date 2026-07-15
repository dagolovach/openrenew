// lib/db/schema.ts
import {
  pgTable, uuid, text, boolean, integer, real, timestamp, date, jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("party_review"),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  extractionConfidence: real("extraction_confidence"),
  filePath: text("file_path"),
  fileName: text("file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  partyA: text("party_a"),
  partyB: text("party_b"),
  effectiveDate: date("effective_date"),
  expiryDate: date("expiry_date"),
  renewalDate: date("renewal_date"),
  autoRenew: boolean("auto_renew"),
  noticePeriodDays: integer("notice_period_days"),
  noticePeriodText: text("notice_period_text"),
  contractValue: text("contract_value"),
  annualValue: real("annual_value"),
  parentContractId: uuid("parent_contract_id"),
  contractVersion: integer("contract_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contractExtractions = pgTable("contract_extractions", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  extractedValue: text("extracted_value"),
  confirmedValue: text("confirmed_value"),
  confidence: real("confidence"),
  wasEdited: boolean("was_edited").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("extractions_contract_field").on(t.contractId, t.fieldName)]);

export const contractAnalysis = pgTable("contract_analysis", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by"),
  findings: jsonb("findings").notNull().default([]),
  model: text("model").notNull().default(""),
  analysisVersion: integer("analysis_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("analysis_contract_version").on(t.contractId, t.analysisVersion)]);

export const contractComparisons = pgTable("contract_comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull().unique()
    .references(() => contracts.id, { onDelete: "cascade" }),
  parentContractId: uuid("parent_contract_id").notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by"),
  fieldChanges: jsonb("field_changes").notNull().default([]),
  clauseChanges: jsonb("clause_changes").notNull().default([]),
  summary: text("summary"),
  model: text("model").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(),
  scheduledFor: date("scheduled_for").notNull(),
  targetDate: date("target_date").notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("alerts_contract_type_target").on(t.contractId, t.alertType, t.targetDate)]);

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  contractId: uuid("contract_id"),
  eventType: text("event_type").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
