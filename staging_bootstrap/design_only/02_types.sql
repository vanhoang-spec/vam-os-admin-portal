-- STAGING ONLY. DESIGN ONLY. NOT AUTHORIZED. NOT EXECUTED.
-- MUST NEVER RUN ON PRODUCTION.
CREATE TYPE public.application_status AS ENUM ('accepted','rejected_or_pending','rejected','pending','withdrawn');
CREATE TYPE public.communication_channel AS ENUM ('email','zalo','sms','call');
CREATE TYPE public.communication_status AS ENUM ('queued','sent','delivered','bounced','failed','opened','clicked');
CREATE TYPE public.event_type AS ENUM ('orientation','training','company_tour','networking','closing','business_case','job_shadowing','other','kickoff');
CREATE TYPE public.gender_type AS ENUM ('male','female','other','undisclosed');
CREATE TYPE public.match_status AS ENUM ('active','dropped','completed','unmatched_review');
CREATE TYPE public.match_type AS ENUM ('primary','cross','secondary');
CREATE TYPE public.role_status AS ENUM ('active','inactive','pending','pending_or_rejected');
CREATE TYPE public.role_type AS ENUM ('mentor','mentee','supporter','speaker','partner_contact','donor','admin');
CREATE TYPE public.season_status AS ENUM ('draft','open','running','closed');
