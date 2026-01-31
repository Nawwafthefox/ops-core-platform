begin;

-- Seed a richer multi-department catalog (example data for local/dev)
-- Based on the Policies & Procedures blueprint.

with c as (
  select id as company_id
  from public.companies
  where name = 'Acme Corp'
  limit 1
)
insert into public.departments (company_id, name)
select c.company_id, d.name
from c
cross join (
  values
    ('Procurement'),
    ('Sales'),
    ('Executive Office'),
    ('Legal'),
    ('Government Relations'),
    ('Internal Audit'),
    ('Warehouses'),
    ('Real Estate')
) as d(name)
on conflict (company_id, name) do nothing;

-- Request types with optional workflow_config templates
with c as (
  select id as company_id
  from public.companies
  where name = 'Acme Corp'
  limit 1
)
insert into public.request_types (company_id, name, description, default_priority, code, workflow_config)
select
  c.company_id,
  rt.name,
  rt.description,
  rt.default_priority,
  rt.code,
  rt.workflow_config
from c
cross join (
  values
    (
      'Procurement PR/PO',
      'Purchase request / purchase order workflow (RFQ, evaluation, PO/contract, delivery, GRN).',
      3,
      'PROC_PR_PO',
      jsonb_build_object(
        'statuses', jsonb_build_array('Draft','Submitted','Manager Approved','In Review','In Progress','Info Required','On Hold','Completed','Closed','Rejected'),
        'sla', jsonb_build_object('manager_approval_days', 2, 'rfq_days', '5-10', 'evaluation_days', 3, 'po_days', 2)
      )
    ),
    (
      'Sales Discount / Contract',
      'Sales discount approvals and contract workflow (Sales → Finance → Legal → Executive if needed).',
      3,
      'SALES_DISCOUNT_CONTRACT',
      '{}'::jsonb
    ),
    (
      'Finance Payment / Expense',
      'Payments, expenses and authorizations with SoD.',
      2,
      'FIN_PAYMENT_EXPENSE',
      '{}'::jsonb
    ),
    (
      'HR Onboarding / Offboarding',
      'Multi-department onboarding/offboarding checklist (HR/IT/GR/Finance/Warehouse).',
      3,
      'HR_ON_OFFBOARDING',
      '{}'::jsonb
    ),
    (
      'IT Service Request',
      'IT service request (fulfillment, QA/test, closure).',
      3,
      'IT_SERVICE_REQUEST',
      '{}'::jsonb
    ),
    (
      'IT Hardware - Laptop',
      'Laptop request with policy check, stock/procurement branching, imaging, handover.',
      3,
      'IT_Hardware_Laptop',
      '{
        "request_type": "IT_Hardware_Laptop",
        "id_key": "national_or_residency_id",
        "statuses": [
          "Draft","Submitted","Manager Approved","IT Policy Check",
          "In Stock | Procurement","Finance Authorization","Warehouse GRN",
          "IT Imaging/Encryption","Handover","Closed","Rejected","Info Required"
        ],
        "roles": {
          "requester": "Employee",
          "approver": "Line Manager",
          "it_reviewer": "IT Service Desk",
          "procurement": "Buyer",
          "finance": ["Finance Reviewer","Financial Approver","Payment Officer"],
          "warehouse": "Storekeeper"
        },
        "routing_rules": [
          {"when": "model_standard AND stock_available", "next": "Warehouse GRN"},
          {"when": "model_standard AND NOT stock_available", "next": "Procurement"},
          {"when": "model_non_standard", "next": "InfoSecApproval THEN Procurement"}
        ],
        "closure_criteria": [
          "AssetTag assigned","Encryption/EDR enabled","Handover form attached"
        ],
        "sla": {
          "manager_approval_days": 1,
          "it_review_days": 1,
          "procurement_days": "5-10",
          "imaging_days": 2
        },
        "attachments_required": ["Justification","Model Spec","Handover Form"]
      }'::jsonb
    ),
    (
      'GR Iqama Renewal',
      'Iqama renewal automation and processing (T-60/T-30/T-7 reminders).',
      2,
      'GR_Iqama_Renewal',
      '{
        "request_type": "GR_Iqama_Renewal",
        "auto_trigger_days_before_expiry": 60,
        "statuses": [
          "Auto-Created","GR Processing","Finance Fees","Waiting External",
          "Renewed","HRIS Update","Closed","Info Required","On Hold"
        ],
        "roles": {
          "owner": "GR Officer",
          "finance": ["Finance Reviewer","Payment Officer"],
          "hr": "HR Coordinator"
        },
        "closure_criteria": [
          "Renewed document attached",
          "HRIS expiry date updated",
          "Payment proof attached"
        ],
        "notifications": [
          "T-60 reminder","T-30 reminder","T-7 urgent","Renewal completed"
        ]
      }'::jsonb
    ),
    (
      'Legal Contract Review',
      'Legal intake, review, negotiation, approval, archiving.',
      3,
      'LEGAL_CONTRACT_REVIEW',
      '{}'::jsonb
    ),
    (
      'Warehouses Receive / Issue',
      'Receiving and issuing workflow (inspection, GRN, handover, closure).',
      3,
      'WH_RECEIVE_ISSUE',
      '{}'::jsonb
    ),
    (
      'Internal Audit Engagement',
      'Planning → fieldwork → report → action plans → follow-up → close.',
      3,
      'IA_ENGAGEMENT',
      '{}'::jsonb
    ),
    (
      'Real Estate / Facilities',
      'Assessment → Legal/Finance → contract/works → handover → close.',
      3,
      'RE_FACILITIES',
      '{}'::jsonb
    )
) as rt(name, description, default_priority, code, workflow_config)
on conflict (company_id, name) do update
set
  description = excluded.description,
  default_priority = excluded.default_priority,
  active = excluded.active,
  code = excluded.code,
  workflow_config = excluded.workflow_config;

-- Department routing + SLA defaults (illustrative only)
select 1;
