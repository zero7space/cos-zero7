from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class UserLogin(BaseModel):
    email: str
    password: str

class UserCreate(BaseModel):
    name: str
    email: str
    password: Optional[str] = None
    role: str = 'member'
    phone: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None

class LeadCreate(BaseModel):
    name: str
    business_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    city: Optional[str] = None
    temperature: Optional[str] = 'warm'
    call_stage: Optional[str] = 'uncontacted'
    source: str = 'manual'
    priority: Optional[str] = 'unexplored'
    deal_value: Optional[float] = None
    assigned_to: Optional[str] = None
    last_update_notes: Optional[str] = None
    next_action: Optional[str] = None
    next_action_date: Optional[str] = None
    next_action_priority: Optional[str] = 'medium'
    channel_data: Optional[dict] = None
    project_path: Optional[str] = None
    subdomain: Optional[str] = None
    subdomain_status: Optional[str] = 'pending'
    demo_video_url: Optional[str] = None
    demo_video_title: Optional[str] = None
    demo_video_status: Optional[str] = 'pending'
    prototype_status: Optional[str] = 'pending'
    prototype_url: Optional[str] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    github_repo_url: Optional[str] = None
    github_repo_status: Optional[str] = 'pending'

class LeadUpdate(BaseModel):
    name: Optional[str] = None
    business_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    city: Optional[str] = None
    temperature: Optional[str] = None
    call_stage: Optional[str] = None
    status: Optional[str] = None
    source: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None
    deal_value: Optional[float] = None
    last_update_notes: Optional[str] = None
    next_action: Optional[str] = None
    next_action_date: Optional[str] = None
    next_action_priority: Optional[str] = None
    channel_data: Optional[dict] = None
    project_path: Optional[str] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    subdomain: Optional[str] = None
    subdomain_status: Optional[str] = None
    demo_video_url: Optional[str] = None
    demo_video_title: Optional[str] = None
    demo_video_status: Optional[str] = None
    prototype_status: Optional[str] = None
    prototype_url: Optional[str] = None
    github_repo_url: Optional[str] = None
    github_repo_status: Optional[str] = None

class DealCreate(BaseModel):
    lead_id: Optional[str] = None
    title: str
    value: Optional[float] = None
    stage: str = 'won'
    delivery_stage: Optional[str] = 'in_development'
    amount_received: Optional[float] = 0.0
    payment_status: Optional[str] = 'pending'
    payment_milestones: Optional[List[dict]] = None
    github_repo_url: Optional[str] = None
    production_url: Optional[str] = None
    demo_url: Optional[str] = None
    proposal_url: Optional[str] = None
    proposal_title: Optional[str] = None
    deliverables: Optional[List[dict]] = None
    city: Optional[str] = None
    assigned_to: Optional[str] = None
    expected_close: Optional[str] = None
    target_delivery_date: Optional[str] = None
    actual_delivery_date: Optional[str] = None
    notes: Optional[str] = None

class DealUpdate(BaseModel):
    title: Optional[str] = None
    value: Optional[float] = None
    stage: Optional[str] = None
    delivery_stage: Optional[str] = None
    amount_received: Optional[float] = None
    payment_status: Optional[str] = None
    payment_milestones: Optional[List[dict]] = None
    github_repo_url: Optional[str] = None
    production_url: Optional[str] = None
    demo_url: Optional[str] = None
    proposal_url: Optional[str] = None
    proposal_title: Optional[str] = None
    deliverables: Optional[List[dict]] = None
    city: Optional[str] = None
    assigned_to: Optional[str] = None
    expected_close: Optional[str] = None
    target_delivery_date: Optional[str] = None
    actual_delivery_date: Optional[str] = None
    notes: Optional[str] = None

class CallLogCreate(BaseModel):
    outcome: str
    notes: Optional[str] = None
    duration_minutes: Optional[int] = None

class NoteCreate(BaseModel):
    content: str

class AgentJobCreate(BaseModel):
    prompt: str
    model: Optional[str] = "flash"
    role: Optional[str] = "engineer"
    agent_slug: Optional[str] = "prototype_maker"
    project_path: Optional[str] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    conversation_id: Optional[str] = None
    rep_context: Optional[Dict[str, Any]] = None
    force: Optional[bool] = False
    execution_target: Optional[str] = "cloud"

class PrototypeRepContextUpdate(BaseModel):
    primary_workflow: Optional[str] = None
    key_screens: Optional[List[str]] = None
    tactical_notes: Optional[str] = None
    target_viewport: Optional[str] = "desktop"
    visual_style: Optional[str] = "zero7_dark"
    deploy_agent_now: Optional[bool] = False

class AgentJobStreamUpdate(BaseModel):
    stream_output: Optional[str] = None
    thoughts: Optional[str] = None
    conversation_id: Optional[str] = None

class AgentJobComplete(BaseModel):
    status: str = "completed"
    stream_output: Optional[str] = None
    thoughts: Optional[str] = None
    error_message: Optional[str] = None
    conversation_id: Optional[str] = None
    artifacts: Optional[list] = None

class WorkerHeartbeat(BaseModel):
    worker_id: str = "local_host"
    machine_name: Optional[str] = None
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    os_info: Optional[str] = None
    install_path: Optional[str] = None
    projects_root: Optional[str] = None
    device_token: Optional[str] = None
    metadata: Optional[dict] = None

class DevicePairRequest(BaseModel):
    email: str
    password: str
    machine_name: Optional[str] = None
    install_path: Optional[str] = None
    projects_root: Optional[str] = None
    os_info: Optional[str] = None

class ConversationTranscriptUpload(BaseModel):
    conversation_id: str
    project_id: Optional[str] = None
    messages: list

class ProjectCreateRequest(BaseModel):
    name: str
    path: Optional[str] = None
    lead_id: Optional[str] = None

class DealMilestoneCreate(BaseModel):
    deal_id: str
    milestone_name: str
    target_amount: float
    status: Optional[str] = "pending"
    due_date: Optional[str] = None
    paid_date: Optional[str] = None
    sort_order: Optional[int] = 0

class DealMilestoneUpdate(BaseModel):
    milestone_name: Optional[str] = None
    target_amount: Optional[float] = None
    status: Optional[str] = None
    due_date: Optional[str] = None
    paid_date: Optional[str] = None
    sort_order: Optional[int] = None

class DealPaymentCreate(BaseModel):
    deal_id: str
    amount: float
    milestone_id: Optional[str] = None
    payment_method: Optional[str] = "bank_transfer"
    transaction_ref: Optional[str] = None
    notes: Optional[str] = None
    paid_at: Optional[str] = None

class DealDeliverableCreate(BaseModel):
    deal_id: str
    title: str
    description: Optional[str] = ""
    status: Optional[str] = "pending"
    sort_order: Optional[int] = 0

class DealDeliverableUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    completed_at: Optional[str] = None
    sort_order: Optional[int] = None

class DealEnvironmentCreate(BaseModel):
    deal_id: str
    env_type: str
    label: str
    url: str
    is_primary: Optional[int] = 0

class ActivityCreate(BaseModel):
    lead_id: str
    activity_type: str
    title: str
    content: Optional[str] = ""
    deal_id: Optional[str] = None
    metadata: Optional[dict] = None

class SubdomainRouteCreate(BaseModel):
    lead_id: str
    subdomain: str
    target_ip: Optional[str] = "68.183.92.215"
    cloudflare_record_id: Optional[str] = None

class LeadAttributionCreate(BaseModel):
    platform: str = "meta_ads"
    campaign_id: Optional[str] = None
    campaign_name: Optional[str] = None
    ad_set_id: Optional[str] = None
    ad_set_name: Optional[str] = None
    ad_id: Optional[str] = None
    ad_name: Optional[str] = None
    creative_type: Optional[str] = None
    creative_thumb_url: Optional[str] = None
    form_id: Optional[str] = None
    form_answers: Optional[list] = None
    raw_payload: Optional[dict] = None

