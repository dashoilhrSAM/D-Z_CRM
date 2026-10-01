// ⚠️ **本文件由脚本生成，不要手改**：`pnpm exec tsx scripts/gen-tenant-purge-plan.ts`
//
// 退租删除计划：删哪些表（scope map 里属于租户的全部模型）、按什么顺序（先子后父）、
// 用什么条件（column → organisationId；relation → 沿 scope map 的路径嵌套）。
// 完整性由 tests/platform-tenant-purge.test.ts 守着：scope map 里每个 column/relation
// 模型都必须在这里出现，且顺序必须是合法拓扑序 —— 漏一个就红。

/** 删除顺序：数组下标越小越先删。最后一项是 Organisation 本身。 */
export const PURGE_ORDER = [
  "AppointmentSlot",
  "Attachment",
  "Attendance",
  "AttendanceCorrection",
  "AttendanceReview",
  "AuditLog",
  "AuthLink",
  "AutomationExecution",
  "Booking",
  "BulkImportSession",
  "ChecklistExecutionItem",
  "ChecklistItem",
  "CommissionClaim",
  "CommissionLedger",
  "CommissionRule",
  "CommissionTier",
  "ContentScript",
  "CustomerAddress",
  "CustomerApproval",
  "CustomerAuthProfile",
  "CustomerConsent",
  "Document",
  "IntegrationConfig",
  "Inventory",
  "InventoryLocation",
  "InvoiceCounter",
  "InvoiceItem",
  "JobStatusHistory",
  "LeadActivity",
  "LoyaltyTransaction",
  "MarketingAsset",
  "Message",
  "MessageTemplate",
  "Notification",
  "Payment",
  "Permission",
  "PromoProduct",
  "PurchaseOrderItem",
  "Quotation",
  "Referral",
  "Review",
  "RewardRedemption",
  "RoleConfig",
  "ScheduledMessage",
  "ServiceHistory",
  "ServiceJobItem",
  "ServiceJobPart",
  "ServiceJobPhoto",
  "ServicePackageItem",
  "ServiceReminder",
  "StaffPayoutPayment",
  "StockMovement",
  "SupportGrant",
  "Task",
  "TestRide",
  "AttendancePunch",
  "AutomationRule",
  "ChecklistExecution",
  "ChecklistTemplate",
  "CommissionTierSet",
  "InspectionFinding",
  "Invoice",
  "Lead",
  "LoyaltyAccount",
  "Product",
  "PurchaseOrder",
  "Reward",
  "ServiceType",
  "StaffPayout",
  "Campaign",
  "LeadSource",
  "LeadStage",
  "LoyaltyTier",
  "ServiceJob",
  "Supplier",
  "Motorcycle",
  "ServicePackage",
  "User",
  "Customer",
  "Branch",
  "Organisation"
] as const;

/** 每个模型的删除条件模板；占位符 ORG 会被替换成真实 organisationId。
 *  Organisation 用 id 主键，其余按 scope map 的路径（column → organisationId，relation → 嵌套）。 */
export const PURGE_WHERE: Record<string, unknown> = {
  "AppointmentSlot": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "Attachment": {
    "organisationId": "{{ORG}}"
  },
  "Attendance": {
    "user": {
      "organisationId": "{{ORG}}"
    }
  },
  "AttendanceCorrection": {
    "punch": {
      "user": {
        "organisationId": "{{ORG}}"
      }
    }
  },
  "AttendanceReview": {
    "punch": {
      "user": {
        "organisationId": "{{ORG}}"
      }
    }
  },
  "AuditLog": {
    "organisationId": "{{ORG}}"
  },
  "AuthLink": {
    "organisationId": "{{ORG}}"
  },
  "AutomationExecution": {
    "rule": {
      "organisationId": "{{ORG}}"
    }
  },
  "Booking": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "BulkImportSession": {
    "organisationId": "{{ORG}}"
  },
  "ChecklistExecutionItem": {
    "execution": {
      "job": {
        "organisationId": "{{ORG}}"
      }
    }
  },
  "ChecklistItem": {
    "template": {
      "organisationId": "{{ORG}}"
    }
  },
  "CommissionClaim": {
    "organisationId": "{{ORG}}"
  },
  "CommissionLedger": {
    "organisationId": "{{ORG}}"
  },
  "CommissionRule": {
    "organisationId": "{{ORG}}"
  },
  "CommissionTier": {
    "tierSet": {
      "organisationId": "{{ORG}}"
    }
  },
  "ContentScript": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "CustomerAddress": {
    "customer": {
      "organisationId": "{{ORG}}"
    }
  },
  "CustomerApproval": {
    "job": {
      "organisationId": "{{ORG}}"
    }
  },
  "CustomerAuthProfile": {
    "customer": {
      "organisationId": "{{ORG}}"
    }
  },
  "CustomerConsent": {
    "customer": {
      "organisationId": "{{ORG}}"
    }
  },
  "Document": {
    "organisationId": "{{ORG}}"
  },
  "IntegrationConfig": {
    "organisationId": "{{ORG}}"
  },
  "Inventory": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "InventoryLocation": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "InvoiceCounter": {
    "organisationId": "{{ORG}}"
  },
  "InvoiceItem": {
    "invoice": {
      "organisationId": "{{ORG}}"
    }
  },
  "JobStatusHistory": {
    "job": {
      "organisationId": "{{ORG}}"
    }
  },
  "LeadActivity": {
    "lead": {
      "organisationId": "{{ORG}}"
    }
  },
  "LoyaltyTransaction": {
    "account": {
      "organisationId": "{{ORG}}"
    }
  },
  "MarketingAsset": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "Message": {
    "organisationId": "{{ORG}}"
  },
  "MessageTemplate": {
    "organisationId": "{{ORG}}"
  },
  "Notification": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "Payment": {
    "invoice": {
      "organisationId": "{{ORG}}"
    }
  },
  "Permission": {
    "organisationId": "{{ORG}}"
  },
  "PromoProduct": {
    "organisationId": "{{ORG}}"
  },
  "PurchaseOrderItem": {
    "purchaseOrder": {
      "branch": {
        "organisationId": "{{ORG}}"
      }
    }
  },
  "Quotation": {
    "job": {
      "organisationId": "{{ORG}}"
    }
  },
  "Referral": {
    "organisationId": "{{ORG}}"
  },
  "Review": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "RewardRedemption": {
    "account": {
      "organisationId": "{{ORG}}"
    }
  },
  "RoleConfig": {
    "organisationId": "{{ORG}}"
  },
  "ScheduledMessage": {
    "organisationId": "{{ORG}}"
  },
  "ServiceHistory": {
    "organisationId": "{{ORG}}"
  },
  "ServiceJobItem": {
    "job": {
      "organisationId": "{{ORG}}"
    }
  },
  "ServiceJobPart": {
    "job": {
      "organisationId": "{{ORG}}"
    }
  },
  "ServiceJobPhoto": {
    "job": {
      "organisationId": "{{ORG}}"
    }
  },
  "ServicePackageItem": {
    "package": {
      "branch": {
        "organisationId": "{{ORG}}"
      }
    }
  },
  "ServiceReminder": {
    "customer": {
      "organisationId": "{{ORG}}"
    }
  },
  "StaffPayoutPayment": {
    "payout": {
      "user": {
        "organisationId": "{{ORG}}"
      }
    }
  },
  "StockMovement": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "SupportGrant": {
    "organisationId": "{{ORG}}"
  },
  "Task": {
    "organisationId": "{{ORG}}"
  },
  "TestRide": {
    "organisationId": "{{ORG}}"
  },
  "AttendancePunch": {
    "user": {
      "organisationId": "{{ORG}}"
    }
  },
  "AutomationRule": {
    "organisationId": "{{ORG}}"
  },
  "ChecklistExecution": {
    "job": {
      "organisationId": "{{ORG}}"
    }
  },
  "ChecklistTemplate": {
    "organisationId": "{{ORG}}"
  },
  "CommissionTierSet": {
    "organisationId": "{{ORG}}"
  },
  "InspectionFinding": {
    "job": {
      "organisationId": "{{ORG}}"
    }
  },
  "Invoice": {
    "organisationId": "{{ORG}}"
  },
  "Lead": {
    "organisationId": "{{ORG}}"
  },
  "LoyaltyAccount": {
    "organisationId": "{{ORG}}"
  },
  "Product": {
    "organisationId": "{{ORG}}"
  },
  "PurchaseOrder": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "Reward": {
    "organisationId": "{{ORG}}"
  },
  "ServiceType": {
    "organisationId": "{{ORG}}"
  },
  "StaffPayout": {
    "user": {
      "organisationId": "{{ORG}}"
    }
  },
  "Campaign": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "LeadSource": {
    "organisationId": "{{ORG}}"
  },
  "LeadStage": {
    "organisationId": "{{ORG}}"
  },
  "LoyaltyTier": {
    "organisationId": "{{ORG}}"
  },
  "ServiceJob": {
    "organisationId": "{{ORG}}"
  },
  "Supplier": {
    "organisationId": "{{ORG}}"
  },
  "Motorcycle": {
    "organisationId": "{{ORG}}"
  },
  "ServicePackage": {
    "branch": {
      "organisationId": "{{ORG}}"
    }
  },
  "User": {
    "organisationId": "{{ORG}}"
  },
  "Customer": {
    "organisationId": "{{ORG}}"
  },
  "Branch": {
    "organisationId": "{{ORG}}"
  },
  "Organisation": {
    "id": "{{ORG}}"
  }
};

/** 不在租户范围内的模型（shared/none）——不参与退租删除，列出来是为了让人一眼能核对。 */
export const NON_TENANT_MODELS = [
  "Organisation",
  "TenantTombstone",
  "PlatformAuditLog",
  "PlatformAdmin",
  "BrandProfile",
  "Occasion",
  "TrendTopic",
  "OtpAttempt"
] as const;
