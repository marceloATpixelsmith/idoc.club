# MemberPress password migration requirements

This document is an index, not a second contract. The authoritative implementation and operations contract is [03 Legacy Data Migration and Reconciliation Plan](03-legacy-data-migration-and-reconciliation-plan.md#legacy-member-first-login-and-credential-migration); the canonical current password policy and authentication controls are in [05 Security and Privacy Requirements](05-security-and-privacy-requirements.md#legacy-credential-and-first-login-controls).

The superseded rule that a legacy member should not change a successfully verified password merely because it fails the current minimum no longer applies. At successful legacy verification, evaluate the entered password under the actual current policy and breached-password control. A failure requires verified-email remediation before any normal session. Do not infer password properties from a stored hash.
