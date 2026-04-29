# VAM OS Master Roadmap Backlog - Phase 3 to Phase 7

## Executive summary

Tai lieu nay la backlog tong the de dua VAM OS tu Admin Portal noi bo sau Phase 2 thanh mot nen tang van hanh mentoring day du hon, co bao mat, quy trinh sua du lieu, intake tu phia nguoi dung, quan ly matching va kha nang mo rong qua nhieu mua/chuong trinh.

Day la backlog lap ke hoach, khong phai cam ket trien khai. Moi hang muc can duoc founder/core team review lai ve uu tien, nguon luc, rui ro du lieu va pham vi truoc khi dua vao sprint coding. Tai lieu nay khong tao migration, khong thay doi app code, va khong import du lieu.

Trang thai hien tai: Phase 2 da hoan thanh cac moc 2A den 2F, gom activity tracking, event participation pilot, Operations Dashboard, correction workflow cho `mentoring_recaps`, Auth/RLS planning va operational team assignments. Uu tien tiep theo nen la bao mat nen tang truoc khi mo rong quyen truy cap hoac cho phep sua them du lieu.

## Mo hinh uu tien

| Priority | Y nghia |
| --- | --- |
| P0 | Bat buoc co truoc khi chia se rong hon |
| P1 | Can co de van hanh on dinh |
| P2 | Cai thien manh ve hieu qua/UX/chat luong du lieu |
| P3 | De sau, phuc vu do truong thanh nen tang |

## Uoc tinh so task

| Phase | Chu de | Uoc tinh small tasks |
| --- | --- | --- |
| Phase 3 | Secure Internal Platform | 30 tasks |
| Phase 4 | Data Correction & Operations Workflow | 30 tasks |
| Phase 5 | Self-Service Intake & Activity Submission | 30 tasks |
| Phase 6 | Matching & Program Management | 40 tasks |
| Phase 7 | Multi-Season / Multi-Program Platform | 30 tasks |
| Tong | Phase 3 den Phase 7 | Khoang 160 tasks |

## Recommended first 15 tasks

| Task ID | Phase | Work package | Task title | Description | Priority | Dependency | Owner type | Risk | Definition of done |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P3A-01 | 3 | 3A | Chot role model | Xac nhan role `viewer`, `admin`, `super_admin` va co can `reviewer` khong. | P0 | Founder decision | founder/core team | medium | Role list, quyen chinh va rule default user duoc approve. |
| P3A-02 | 3 | 3A | Chot RLS rollout order | Chon thu tu bat RLS theo nhom bang de giam rui ro downtime. | P0 | P3A-01 | dev/data steward | high | Co rollout order va rollback rule bang van ban. |
| P3B-01 | 3 | 3B | Thiet ke admin user table | Dinh nghia schema role table va audit field can thiet. | P0 | P3A-01 | dev | medium | Schema proposal duoc review, chua tao migration. |
| P3B-02 | 3 | 3B | Chot super admin dau tien | Xac dinh email/auth identity co quyen cao nhat luc khoi tao. | P0 | P3B-01 | founder | medium | Danh sach super_admin ban dau duoc approve. |
| P3C-01 | 3 | 3C | Login/logout UX spec | Mo ta man hinh dang nhap/dang xuat toi thieu va error states. | P0 | P3A-01 | dev/core team | medium | Spec ngan gon duoc approve truoc coding. |
| P3D-01 | 3 | 3D | Route protection map | Liet ke route nao can login va role nao duoc truy cap. | P0 | P3A-01 | dev | high | Route/role matrix hoan tat cho cac trang admin hien co. |
| P3E-01 | 3 | 3E | Read policy scope | Chot bang nao cho `viewer+` doc va bang nao can han che hon. | P0 | P3D-01 | dev/data steward | high | RLS read policy matrix duoc approve. |
| P3F-01 | 3 | 3F | Correction write policy scope | Gioi han write policy cho correction workflow `mentoring_recaps`. | P0 | P3E-01 | dev | high | Field/action duoc phep update duoc document ro. |
| P3G-01 | 3 | 3G | Correction UI role gate | Xac dinh cac nut/form correction chi hien voi `admin+`. | P0 | P3D-01 | dev | medium | UI permission checklist duoc approve. |
| P3H-01 | 3 | 3H | Security QA checklist | Tao checklist test login, role, anonymous access va RLS. | P0 | P3E-01, P3F-01 | dev/core team | high | Checklist bao phu viewer/admin/super_admin va negative tests. |
| P3I-01 | 3 | 3I | Password gate replacement criteria | Dinh nghia dieu kien du de tat temporary password gate. | P0 | P3H-01 | founder/dev | high | Go/no-go criteria duoc approve. |
| P3J-01 | 3 | 3J | Admin guide auth update | Cap nhat noi dung huong dan dang nhap, role va correction permission. | P0 | P3C-01, P3G-01 | core team/dev | low | Admin guide co muc Auth/Roles moi. |
| P4A-01 | 4 | 4A | Generic correction model | Dinh nghia pattern chung cho request, review, apply, audit correction. | P1 | Phase 3 complete | dev/data steward | high | Model duoc approve, co field audit bat buoc. |
| P4F-01 | 4 | 4F | Data Issues status model | Chot cac trang thai open/in_review/resolved/deferred. | P1 | Phase 3 complete | core team/data steward | medium | Status model va rule chuyen trang thai ro rang. |
| P4G-01 | 4 | 4G | Action item foundation | Dinh nghia bang/field action item cho owner, deadline, status. | P1 | Phase 3 complete | dev/core team | medium | Data model draft va workflow owner duoc approve. |

## Full backlog by phase

## Phase 3 - Secure Internal Platform

Theme: Thay temporary password gate bang authentication that, role va RLS. Nen hoan thanh Phase 3 truoc khi mo rong nguoi dung noi bo hoac them workflow sua du lieu.

### 3A. Auth/RLS planning finalization

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3A-01 | Chot role model | Xac nhan role ban dau va quyen theo tung role. | P0 | Founder decision | Role list duoc founder/core team approve. |
| P3A-02 | Chot RLS rollout order | Sap xep thu tu bat RLS theo nhom bang. | P0 | P3A-01 | Co rollout order va rollback note. |
| P3A-03 | Chot du lieu nhay cam | Danh dau bang/field co PII hoac can han che. | P0 | P3A-01 | Co data sensitivity matrix. |

### 3B. Admin user/role table

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3B-01 | Thiet ke admin user table | Dinh nghia table role gan voi Supabase Auth user. | P0 | P3A-01 | Schema proposal duoc review. |
| P3B-02 | Chot super admin dau tien | Xac dinh identity khoi tao co quyen cao nhat. | P0 | P3B-01 | Email/auth id duoc approve. |
| P3B-03 | Role audit plan | Quyet dinh co log thay doi role ngay Phase 3 hay khong. | P1 | P3B-01 | Decision va audit field duoc ghi lai. |

### 3C. Login/logout UI

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3C-01 | Login/logout UX spec | Mo ta UI dang nhap, dang xuat, loi va loading. | P0 | P3A-01 | Spec duoc approve. |
| P3C-02 | Session state behavior | Chot hanh vi khi session het han hoac user disabled. | P0 | P3C-01 | Edge cases duoc document. |
| P3C-03 | Auth copywriting | Viet text ngan gon cho login errors va access denied. | P1 | P3C-01 | Message set san sang dua vao app. |

### 3D. Route protection

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3D-01 | Route protection map | Lap ma tran route theo role. | P0 | P3A-01 | Tat ca route admin hien co duoc map. |
| P3D-02 | Unassigned user rule | Dinh nghia user login nhung chua co role se thay gi. | P0 | P3D-01 | Behavior duoc founder/core team approve. |
| P3D-03 | Protected route QA cases | Viet test cases cho redirect/access denied. | P0 | P3D-01 | QA checklist co happy path va negative path. |

### 3E. RLS read policies

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3E-01 | Read policy scope | Chot bang nao `viewer+` duoc doc. | P0 | P3D-01 | Read policy matrix duoc approve. |
| P3E-02 | Anonymous deny rules | Dinh nghia rule chan anonymous read. | P0 | P3E-01 | Tat ca bang admin co anonymous deny expectation. |
| P3E-03 | Application data exception | Quyet dinh muc xem du lieu applications. | P1 | P3E-01 | Scope applications duoc founder approve. |

### 3F. RLS write policies for correction workflow

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3F-01 | Mentoring recap write scope | Gioi han field/action correction duoc phep. | P0 | P3E-01 | Field list va allowed role ro rang. |
| P3F-02 | Audit insert policy plan | Dinh nghia ai duoc insert correction log. | P0 | P3F-01 | Audit policy expectation duoc document. |
| P3F-03 | Delete ban rule | Xac nhan khong role nao duoc delete operational/audit data. | P0 | P3F-01 | Delete prohibition duoc ghi ro. |

### 3G. Role-based UI controls

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3G-01 | Correction UI role gate | Chi `admin+` thay/dung correction action. | P0 | P3D-01 | UI permission checklist duoc approve. |
| P3G-02 | Read-only viewer behavior | Xac dinh UI cho viewer khi khong co quyen sua. | P1 | P3G-01 | Viewer UX khong gay nham lan. |
| P3G-03 | Super admin controls inventory | Liet ke control nao chi danh cho super_admin. | P2 | P3B-02 | Inventory duoc ghi lai, co the de sau coding. |

### 3H. Security QA

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3H-01 | Security QA checklist | Bao phu login, route, RLS, correction. | P0 | P3E-01, P3F-01 | Checklist duoc approve. |
| P3H-02 | Test account matrix | Chuan bi role test: viewer/admin/super_admin/no-role. | P0 | P3H-01 | Account matrix san sang cho QA. |
| P3H-03 | Rollback drill plan | Mo ta cach phuc hoi password gate/RLS neu loi. | P1 | P3H-01 | Rollback plan co owner va dieu kien kich hoat. |

### 3I. Replace password gate

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3I-01 | Replacement criteria | Chot dieu kien de tat password gate. | P0 | P3H-01 | Go/no-go checklist duoc approve. |
| P3I-02 | Transition comms | Soan thong bao cho core team ve cach dang nhap moi. | P1 | P3C-01 | Message noi bo san sang gui. |
| P3I-03 | Access review after cutover | Ke hoach review ai dang co role sau khi chuyen doi. | P1 | P3I-01 | Co lich review va owner. |

### 3J. Admin user guide update

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P3J-01 | Auth guide update | Them huong dan login/logout va access denied. | P0 | P3C-01 | Admin guide cap nhat noi dung Auth. |
| P3J-02 | Role guide update | Giai thich viewer/admin/super_admin. | P1 | P3A-01 | Role section ro rang cho non-dev. |
| P3J-03 | Correction permission guide | Mo ta ai duoc sua recap va khi nao can ly do. | P1 | P3F-01 | Guide co rule correction va audit. |

## Phase 4 - Data Correction & Operations Workflow

Theme: Chuyen tu dashboard sang hanh dong van hanh va sua du lieu co kiem soat.

### 4A. Generic correction framework

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4A-01 | Generic correction model | Thiet ke pattern request/review/apply/audit. | P1 | Phase 3 complete | Model duoc approve. |
| P4A-02 | Correction reason taxonomy | Chuan hoa ly do sua: typo, source mismatch, duplicate, missing. | P1 | P4A-01 | Reason list duoc core team approve. |
| P4A-03 | Correction permission matrix | Xac dinh role nao sua bang/field nao. | P1 | P4A-01 | Matrix duoc ghi trong docs. |

### 4B. People profile correction

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4B-01 | People editable field list | Chot field people nao duoc sua. | P1 | P4A-03 | Field list duoc approve. |
| P4B-02 | People correction audit | Dinh nghia audit payload cho people corrections. | P1 | P4B-01 | Audit schema draft co old/new value. |
| P4B-03 | People correction QA cases | Viet case cho sua ten, email, phone, status neu co. | P2 | P4B-01 | QA cases hoan tat. |

### 4C. Mentor profile correction

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4C-01 | Mentor editable field list | Chot field mentor profile duoc sua. | P1 | P4A-03 | Field list duoc approve. |
| P4C-02 | Mentor source-of-truth rule | Xac dinh khi nao uu tien form/application/manual source. | P1 | P4C-01 | Source rule duoc document. |
| P4C-03 | Mentor correction QA cases | Test capacity, team, availability, contact fields. | P2 | P4C-01 | QA cases hoan tat. |

### 4D. Mentee profile correction

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4D-01 | Mentee editable field list | Chot field mentee profile duoc sua. | P1 | P4A-03 | Field list duoc approve. |
| P4D-02 | Sensitive field handling | Xac dinh field hoc tap/nhu cau nao can han che. | P1 | P4D-01 | Rule cho sensitive fields duoc approve. |
| P4D-03 | Mentee correction QA cases | Test school, major, need, contact, status. | P2 | P4D-01 | QA cases hoan tat. |

### 4E. Event participation correction

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4E-01 | Event correction field list | Chot field attendance/check-in co the sua. | P1 | P4A-03 | Field list duoc approve. |
| P4E-02 | Event source confidence | Gan muc tin cay cho FB, form, manual check-in. | P1 | P4E-01 | Confidence rules duoc document. |
| P4E-03 | Event correction QA cases | Test attended/no-show/registered/source update. | P2 | P4E-01 | QA cases hoan tat. |

### 4F. Data Issues resolve workflow

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4F-01 | Data Issues status model | Chot status open/in_review/resolved/deferred. | P1 | Phase 3 complete | Status model duoc approve. |
| P4F-02 | Resolve evidence rule | Dinh nghia can ghi chu/bang chung nao khi resolve. | P1 | P4F-01 | Evidence rule ro rang. |
| P4F-03 | Data Issues QA cases | Test loc theo status, owner va resolution note. | P2 | P4F-01 | QA cases hoan tat. |

### 4G. Action items table

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4G-01 | Action item data model | Dinh nghia owner, deadline, status, linked person/match. | P1 | Phase 3 complete | Model draft duoc approve. |
| P4G-02 | Action status taxonomy | Chot todo/in_progress/done/blocked/cancelled. | P1 | P4G-01 | Status list duoc approve. |
| P4G-03 | Action audit rule | Xac dinh thay doi nao can log. | P2 | P4G-01 | Audit expectation duoc document. |

### 4H. Follow-up queue

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4H-01 | Follow-up candidate rules | Chot rule dua nguoi vao queue. | P1 | P4G-01 | Rule list duoc approve. |
| P4H-02 | Follow-up queue columns | Chon cot hien thi cho core team thao tac nhanh. | P2 | P4H-01 | Column spec hoan tat. |
| P4H-03 | Queue filtering plan | Loc theo owner, deadline, risk, status. | P2 | P4H-02 | Filter spec hoan tat. |

### 4I. Owner/deadline/status tracking

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4I-01 | Owner assignment rule | Xac dinh ai co the nhan/gan action. | P1 | P4G-01 | Owner rule duoc approve. |
| P4I-02 | Deadline policy | Chot deadline mac dinh theo loai issue. | P2 | P4I-01 | Deadline policy co fallback. |
| P4I-03 | Overdue behavior | Dinh nghia overdue highlight/escalation. | P2 | P4I-02 | Overdue behavior duoc document. |

### 4J. Monthly ops report export

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P4J-01 | Monthly report metrics | Chot KPI can export moi thang. | P2 | P4F-01, P4G-01 | KPI list duoc approve. |
| P4J-02 | Export format decision | Chon CSV, Markdown, PDF, hoac Google Sheet flow. | P2 | P4J-01 | Format duoc approve. |
| P4J-03 | Sharing boundary | Xac dinh report nao duoc share ngoai core team. | P1 | P4J-01 | Boundary duoc founder approve. |

## Phase 5 - Self-Service Intake & Activity Submission

Theme: Giam viec thu cong tu Excel/Facebook bang cach cho nguoi dung submit du lieu truc tiep.

### 5A. Public/private form architecture

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5A-01 | Form access model | Chot form nao public, form nao can login. | P1 | Phase 3 complete | Access model duoc approve. |
| P5A-02 | Submission staging model | Dinh nghia submitted/pending_review/approved/rejected. | P1 | P5A-01 | Review states duoc document. |
| P5A-03 | Form privacy copy | Viet consent/privacy text toi thieu. | P1 | P5A-01 | Copy duoc founder/core team approve. |

### 5B. Mentee recap submission form

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5B-01 | Recap form fields | Chot field mentee recap tu submit. | P1 | P5A-02 | Field spec hoan tat. |
| P5B-02 | Recap identity matching | Xac dinh cach match submitter voi person/match. | P1 | P5B-01 | Matching rule duoc approve. |
| P5B-03 | Recap review criteria | Dinh nghia khi nao auto-approve hay manual review. | P1 | P5B-02 | Criteria ro rang. |

### 5C. Mentor pulse form

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5C-01 | Pulse question set | Chon cau hoi ngan ve tinh trang match. | P2 | P5A-02 | Question set duoc approve. |
| P5C-02 | Risk signal mapping | Map cau tra loi thanh canh bao follow-up. | P2 | P5C-01 | Signal mapping ro rang. |
| P5C-03 | Pulse cadence decision | Chot gui hang tuan, hai tuan hay theo event. | P2 | P5C-01 | Cadence duoc approve. |

### 5D. Event registration form

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5D-01 | Registration field set | Chot field dang ky event. | P2 | P5A-01 | Field spec hoan tat. |
| P5D-02 | Event capacity rule | Xac dinh waitlist/capacity neu event gioi han cho. | P2 | P5D-01 | Capacity rule duoc document. |
| P5D-03 | Registration duplicate rule | Chan dang ky trung nguoi/event. | P2 | P5D-01 | Duplicate rule duoc approve. |

### 5E. Event check-in form

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5E-01 | Check-in method decision | Chon QR, code, manual search, hoac hybrid. | P2 | P5D-01 | Method duoc approve. |
| P5E-02 | Late/manual check-in rule | Dinh nghia cach sua check-in sau event. | P2 | P5E-01 | Rule duoc document. |
| P5E-03 | Attendance reconciliation | So sanh registration, check-in, FB/manual source. | P2 | P5E-02 | Reconciliation plan hoan tat. |

### 5F. Feedback form

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5F-01 | Feedback question set | Chot cau hoi cho event/program feedback. | P2 | P5A-02 | Question set duoc approve. |
| P5F-02 | Anonymous option decision | Quyet dinh co cho anonymous feedback khong. | P2 | P5F-01 | Privacy decision ro rang. |
| P5F-03 | Feedback tagging | Tag feedback theo event/match/person/season. | P2 | P5F-01 | Tagging model duoc document. |

### 5G. Review/approval workflow

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5G-01 | Review queue model | Dinh nghia queue cho submissions cho duyet. | P1 | P5A-02 | Queue model duoc approve. |
| P5G-02 | Approval permission | Chot role nao approve/reject data submit. | P1 | P5G-01 | Permission matrix hoan tat. |
| P5G-03 | Rejection reason taxonomy | Chuan hoa ly do reject: duplicate, invalid, unclear. | P2 | P5G-01 | Reason list duoc approve. |

### 5H. Notification/email flow

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5H-01 | Notification trigger list | Xac dinh luc nao gui email/thong bao. | P2 | P5G-01 | Trigger list duoc approve. |
| P5H-02 | Email template inventory | Liet ke template can co: confirmation, reminder, review. | P2 | P5H-01 | Template inventory hoan tat. |
| P5H-03 | Delivery risk plan | Dinh nghia cach theo doi failed delivery/resend. | P3 | P5H-02 | Risk plan duoc document. |

### 5I. Anti-duplicate checks

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5I-01 | Duplicate keys | Chot key trung: email, phone, name, event, match. | P1 | P5A-02 | Duplicate key matrix hoan tat. |
| P5I-02 | Fuzzy match threshold | Xac dinh nguong can manual review. | P2 | P5I-01 | Threshold proposal duoc approve. |
| P5I-03 | Duplicate review UX | Mo ta reviewer thay gi khi nghi trung. | P2 | P5I-02 | UX spec hoan tat. |

### 5J. Mobile UX

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P5J-01 | Mobile form layout rules | Dinh nghia layout cho mobile-first submission. | P2 | P5A-01 | Layout rules duoc approve. |
| P5J-02 | Low-bandwidth behavior | Chot error/loading/save behavior khi mang yeu. | P3 | P5J-01 | Behavior duoc document. |
| P5J-03 | Mobile QA checklist | Tao checklist cho phone viewport va touch input. | P2 | P5J-01 | Checklist san sang cho QA. |

## Phase 6 - Matching & Program Management

Theme: Bien VAM OS thanh he thong quan ly vong doi chuong trinh mentoring.

### 6A. Mentor capacity dashboard

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6A-01 | Capacity metric definition | Chot mentor capacity, current load, availability. | P1 | Phase 4 stable | Metrics duoc approve. |
| P6A-02 | Capacity source mapping | Xac dinh data lay tu profile, form, manual update. | P1 | P6A-01 | Source map hoan tat. |
| P6A-03 | Capacity risk flags | Dinh nghia over-capacity, no-response, low-activity. | P2 | P6A-01 | Flag rules duoc document. |
| P6A-04 | Capacity dashboard QA | Tao case test count/load/filter. | P2 | P6A-01 | QA cases hoan tat. |

### 6B. Mentee needs/preferences dashboard

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6B-01 | Needs taxonomy | Chuan hoa nhu cau mentee theo nhom. | P1 | Phase 4 stable | Taxonomy duoc approve. |
| P6B-02 | Preference fields | Chot field ve industry, skill, schedule, style. | P1 | P6B-01 | Field list hoan tat. |
| P6B-03 | Data completeness score | Dinh nghia diem day du ho so de match. | P2 | P6B-02 | Scoring rule duoc document. |
| P6B-04 | Needs dashboard QA | Tao case test filter/group/export. | P2 | P6B-01 | QA cases hoan tat. |

### 6C. Matching recommendation logic

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6C-01 | Matching criteria list | Chot tieu chi: goal, field, capacity, schedule, risk. | P2 | P6A-01, P6B-01 | Criteria duoc approve. |
| P6C-02 | Hard vs soft constraints | Phan biet dieu kien bat buoc va diem cong. | P2 | P6C-01 | Constraint model ro rang. |
| P6C-03 | Recommendation explanation | Dinh nghia cach giai thich vi sao goi y match. | P2 | P6C-02 | Explanation format duoc approve. |
| P6C-04 | Bias/risk review | Review rui ro goi y sai, thieu du lieu, thien lech. | P2 | P6C-01 | Risk note duoc approve. |

### 6D. Manual match approval

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6D-01 | Approval status model | Chot draft/proposed/approved/rejected. | P1 | P6C-01 | Status model duoc approve. |
| P6D-02 | Approver role rule | Xac dinh ai duoc approve match. | P1 | P6D-01 | Permission rule hoan tat. |
| P6D-03 | Approval audit fields | Log nguoi duyet, ngay, ly do, note. | P1 | P6D-01 | Audit fields duoc document. |
| P6D-04 | Match approval QA | Tao case approve/reject/change mentor. | P2 | P6D-01 | QA cases hoan tat. |

### 6E. Match lifecycle

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6E-01 | Lifecycle status model | Chot proposed/active/paused/dropped/completed. | P1 | P6D-01 | Status model duoc approve. |
| P6E-02 | Status transition rules | Dinh nghia ai duoc chuyen trang thai nao. | P1 | P6E-01 | Transition matrix hoan tat. |
| P6E-03 | Lifecycle timeline view | Mo ta timeline can hien tren match detail. | P2 | P6E-01 | Timeline spec hoan tat. |
| P6E-04 | Lifecycle QA cases | Test transition, audit, filter theo status. | P2 | P6E-02 | QA cases hoan tat. |

### 6F. Re-match workflow

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6F-01 | Re-match trigger rules | Chot khi nao can re-match. | P1 | P6E-01 | Trigger list duoc approve. |
| P6F-02 | Re-match request model | Dinh nghia request, reason, priority, owner. | P1 | P6F-01 | Model duoc document. |
| P6F-03 | Previous match audit | Giu lich su match cu va ly do ket thuc. | P1 | P6F-02 | Audit rule ro rang. |
| P6F-04 | Re-match QA cases | Test request, approve, close old match, create new match. | P2 | P6F-02 | QA cases hoan tat. |

### 6G. Dropped/paused workflow

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6G-01 | Pause/drop reason taxonomy | Chuan hoa ly do tam dung/roi chuong trinh. | P1 | P6E-01 | Reason list duoc approve. |
| P6G-02 | Intervention before drop | Dinh nghia buoc follow-up truoc khi drop. | P1 | P6G-01 | Intervention rule hoan tat. |
| P6G-03 | Privacy note for drop | Xac dinh thong tin nhay cam nao khong hien rong. | P1 | P6G-01 | Privacy rule duoc approve. |
| P6G-04 | Dropped/paused QA cases | Test status, note visibility, report count. | P2 | P6G-01 | QA cases hoan tat. |

### 6H. Certificate eligibility

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6H-01 | Eligibility criteria | Chot dieu kien cap chung nhan. | P2 | P6E-01 | Criteria duoc founder/core team approve. |
| P6H-02 | Evidence source mapping | Map recap/event/feedback thanh bang chung. | P2 | P6H-01 | Source map hoan tat. |
| P6H-03 | Exception process | Dinh nghia ngoai le va nguoi approve. | P2 | P6H-01 | Exception rule duoc document. |
| P6H-04 | Eligibility QA cases | Test eligible/not eligible/exception. | P2 | P6H-01 | QA cases hoan tat. |

### 6I. End-of-season report

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6I-01 | Season KPI list | Chot KPI tong ket mua. | P2 | P6E-01 | KPI list duoc approve. |
| P6I-02 | Narrative report outline | Dinh nghia cau truc report cho founder/core team. | P2 | P6I-01 | Outline hoan tat. |
| P6I-03 | Report data quality checks | Xac dinh check truoc khi export report. | P2 | P6I-01 | Checklist hoan tat. |
| P6I-04 | Sharing version decision | Chia ban noi bo va ban public neu can. | P2 | P6I-02 | Sharing scope duoc approve. |

### 6J. Season close/archive

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P6J-01 | Close criteria | Chot dieu kien dong season. | P2 | P6I-01 | Criteria duoc approve. |
| P6J-02 | Archive read-only rule | Xac dinh du lieu nao khoa sua sau close. | P2 | P6J-01 | Archive rule duoc document. |
| P6J-03 | Carry-over data rule | Chot mentor/alumni/people nao chuyen sang season sau. | P2 | P6J-01 | Carry-over rule duoc approve. |
| P6J-04 | Close QA checklist | Test dashboard/report sau khi close. | P2 | P6J-01 | QA checklist hoan tat. |

## Phase 7 - Multi-Season / Multi-Program Platform

Theme: Tong quat hoa VAM OS vuot ra ngoai UEH Mentoring Season 11.

### 7A. Multi-season architecture cleanup

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7A-01 | Season entity review | Review cac bang can gan season_id ro rang. | P3 | Phase 6 close plan | Entity list hoan tat. |
| P7A-02 | Season filter strategy | Dinh nghia filter season tren dashboard/profile. | P3 | P7A-01 | Strategy duoc approve. |
| P7A-03 | Season migration risk note | Danh gia rui ro khi backfill season data. | P3 | P7A-01 | Risk note hoan tat. |

### 7B. Program table/generalization

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7B-01 | Program entity design | Dinh nghia program khac season nhu the nao. | P3 | P7A-01 | Program model draft duoc approve. |
| P7B-02 | Program-season relation | Chot quan he program -> seasons/cohorts. | P3 | P7B-01 | Relation rule ro rang. |
| P7B-03 | Naming cleanup plan | Ghi lai noi nao dang hard-code UEH/S11. | P3 | P7B-01 | Cleanup inventory hoan tat. |

### 7C. Multi-program dashboard

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7C-01 | Cross-program KPI list | Chot KPI so sanh giua chuong trinh. | P3 | P7B-01 | KPI list duoc approve. |
| P7C-02 | Program selector UX | Mo ta UI chon program/season. | P3 | P7C-01 | UX spec hoan tat. |
| P7C-03 | Access boundary by program | Xac dinh user co duoc xem tat ca program khong. | P3 | P7B-01 | Access rule duoc approve. |

### 7D. Alumni/mentor CRM

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7D-01 | CRM field definition | Chot field alumni/mentor long-term. | P3 | P7B-01 | Field list duoc approve. |
| P7D-02 | Consent/contact preference | Xac dinh consent lien lac sau chuong trinh. | P3 | P7D-01 | Consent rule hoan tat. |
| P7D-03 | CRM segmentation plan | Segment theo role, season, industry, engagement. | P3 | P7D-01 | Segment plan duoc document. |

### 7E. Longitudinal mentee journey

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7E-01 | Journey milestone model | Dinh nghia milestone cua mentee qua nhieu season. | P3 | P7A-01 | Milestone model duoc approve. |
| P7E-02 | Privacy boundary | Xac dinh ai duoc xem lich su nhieu season. | P3 | P7E-01 | Privacy rule duoc approve. |
| P7E-03 | Journey report concept | Mo ta report tien trien ca nhan/nhom. | P3 | P7E-01 | Concept duoc document. |

### 7F. Cross-season mentor history

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7F-01 | Mentor history fields | Chot field ve lich su tham gia mentor. | P3 | P7A-01 | Field list duoc approve. |
| P7F-02 | Performance summary rule | Dinh nghia summary khong gay sai lech/qua danh gia. | P3 | P7F-01 | Summary rule duoc approve. |
| P7F-03 | Re-invite readiness | Chot tin hieu nen moi mentor tham gia lai. | P3 | P7F-01 | Readiness criteria hoan tat. |

### 7G. Data warehouse/export

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7G-01 | Export audience map | Xac dinh export cho founder, ops, public, research. | P3 | P7B-01 | Audience map duoc approve. |
| P7G-02 | De-identification rules | Dinh nghia an danh/loai PII khi export. | P3 | P7G-01 | De-id rule duoc approve. |
| P7G-03 | Warehouse schema concept | Phac thao fact/dimension cho analytics. | P3 | P7G-01 | Concept doc hoan tat. |

### 7H. Public/private reporting

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7H-01 | Public report boundary | Chot chi so nao duoc cong khai. | P3 | P7G-02 | Boundary duoc founder approve. |
| P7H-02 | Private report boundary | Chot noi dung chi core team/admin duoc xem. | P3 | P7H-01 | Private scope ro rang. |
| P7H-03 | Report approval workflow | Dinh nghia ai duyet report truoc khi share. | P3 | P7H-01 | Approval workflow duoc document. |

### 7I. Admin settings

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7I-01 | Settings inventory | Liet ke cau hinh can dua vao admin settings. | P3 | P7B-01 | Inventory hoan tat. |
| P7I-02 | Settings permission | Chot ai duoc xem/sua settings. | P3 | P7I-01 | Permission rule duoc approve. |
| P7I-03 | Settings audit rule | Xac dinh thay doi setting nao can audit. | P3 | P7I-01 | Audit rule hoan tat. |

### 7J. System monitoring/backup

| Task ID | Task title | Short description | Priority | Dependency | Definition of done |
| --- | --- | --- | --- | --- | --- |
| P7J-01 | Monitoring checklist | Chot nhung signal can theo doi: errors, auth, DB, jobs. | P3 | Phase 3 complete | Checklist hoan tat. |
| P7J-02 | Backup/restore expectation | Xac dinh tan suat backup va restore test. | P3 | P7J-01 | Backup expectation duoc approve. |
| P7J-03 | Incident response owner | Chot ai nhan thong bao va xu ly incident. | P3 | P7J-01 | Owner va escalation path ro rang. |

## Recommended Sprint 1

Sprint 1 nen tap trung vao nen bao mat toi thieu truoc khi coding cac workflow sua du lieu moi.

Muc tieu:

- Auth/RLS.
- User roles.
- Protect correction workflow.
- Minimum role-based UI controls.
- Update admin guide.

Suggested scope:

| Task ID | Ly do dua vao Sprint 1 |
| --- | --- |
| P3A-01 | Can chot role truoc moi thiet ke Auth/RLS. |
| P3A-02 | Giam rui ro khi bat RLS. |
| P3A-03 | Bao ve PII va applications data. |
| P3B-01 | Nen tang cho user roles. |
| P3B-02 | Can super_admin khoi tao. |
| P3C-01 | Can UX login/logout ro rang. |
| P3D-01 | Bao ve cac route admin hien co. |
| P3E-01 | Chot read policies truoc migration/code. |
| P3F-01 | Bao ve correction workflow da co. |
| P3F-02 | Giu audit trail dang tin cay. |
| P3G-01 | Ngan viewer sua du lieu. |
| P3H-01 | QA bat buoc truoc go-live. |
| P3I-01 | Dieu kien de thay password gate. |
| P3J-01 | Admin guide phai khop cach login moi. |
| P3J-03 | Huong dan correction permission cho core team. |

Exit criteria:

- Founder/core team approve role model va route/role matrix.
- Co security QA checklist cho viewer/admin/super_admin/no-role.
- Co policy scope cho read va write correction.
- Co tieu chi ro rang de thay temporary password gate.
- Admin guide duoc cap nhat noi dung Auth/Roles/Correction permission.

## Recommended Sprint 2

Sprint 2 nen chi bat dau sau khi Sprint 1 da duoc approve va Auth/RLS/audit controls du dieu kien trien khai.

Muc tieu:

- Generic profile correction.
- Data Issues resolve workflow.
- Follow-up/action_items foundation.

Suggested scope:

| Task ID | Ly do dua vao Sprint 2 |
| --- | --- |
| P4A-01 | Nen tang chung de khong viet moi correction tung bang. |
| P4A-02 | Chuan hoa ly do sua du lieu. |
| P4A-03 | Gan permission vao tung field/bang. |
| P4B-01 | Mo correction cho people profile co kiem soat. |
| P4B-02 | Giu audit cho profile corrections. |
| P4C-01 | Chuan bi correction cho mentor profile. |
| P4D-01 | Chuan bi correction cho mentee profile. |
| P4F-01 | Data Issues can status de dong vong xu ly. |
| P4F-02 | Resolve can bang chung/note. |
| P4G-01 | Action items la nen cho follow-up. |
| P4G-02 | Status action item can thong nhat som. |
| P4H-01 | Queue can rule dua nguoi vao follow-up. |
| P4I-01 | Owner assignment can ro de van hanh. |
| P4J-01 | Report monthly can biet KPI nao lay tu workflow moi. |
| P4J-03 | Chia se report can boundary bao mat. |

Exit criteria:

- Co correction model chung va permission matrix.
- Data Issues co status/resolution concept ro rang.
- Action items co owner/deadline/status foundation.
- Follow-up queue co rule dua vao queue.
- Monthly ops report co KPI va sharing boundary duoc approve.

## Do not do yet

Khong nen lam cac hang muc sau cho den khi Auth/RLS va audit controls ton tai:

- Full matching recommendation.
- Public self-submit form.
- Multi-program rewrite.
- Deleting/merging people.
- Broad application decision editing.

Ly do: cac hang muc nay tang rui ro ve PII, sai du lieu, quyen truy cap, audit trail va tac dong van hanh. Neu lam som, he thong co the mo rong nhanh nhung kho kiem soat nguoi sua, ly do sua va kha nang phuc hoi.

## Open decisions for founder/core team

- Ai co the la `admin`/`super_admin`?
- Ai co the correct profile data?
- Ai owns follow-up actions?
- Khi nao ngung dung password gate?
- Bao cao nao nen chia se voi cong dong rong hon?
- Du lieu nao mentors/mentees co the thay trong tuong lai?

## Recommended next step

Review and approve Sprint 1 scope before coding.
