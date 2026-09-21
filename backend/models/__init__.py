"""Регистрируем все модели чтобы Base.metadata.create_all их видел."""
from .user import User           # noqa: F401
from .auth_session import AuthSession  # noqa: F401
from .workspace import Workspace, WorkspaceMember      # noqa: F401
from .task import Task                 # noqa: F401
from .integration import Integration           # noqa: F401
from .integration_streamer import IntegrationStreamer  # noqa: F401
from .integration_payment import IntegrationPayment  # noqa: F401
from .streamer_profile import StreamerProfile  # noqa: F401
from .case_study import CaseStudy  # noqa: F401
from .brief_file import BriefFile  # noqa: F401
from .advertiser import Advertiser  # noqa: F401
from .brand_contact import BrandContact  # noqa: F401
from .discussion_message import DiscussionMessage  # noqa: F401
from .discussion_read import DiscussionMessageRead  # noqa: F401
from .audit_log import AuditLogEntry  # noqa: F401
