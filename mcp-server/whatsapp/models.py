"""
Pydantic models for WhatsApp API responses.
"""

from typing import Optional, List
from pydantic import BaseModel


class Chat(BaseModel):
    """Represents a WhatsApp chat."""
    jid: str
    name: Optional[str] = None
    is_group: bool = False
    last_message_time: Optional[str] = None
    last_message_preview: Optional[str] = None
    unread_count: int = 0


class Message(BaseModel):
    """Represents a WhatsApp message."""
    id: str
    chat_jid: str
    sender: Optional[str] = None
    sender_name: Optional[str] = None
    content: Optional[str] = None
    timestamp: Optional[str] = None
    is_from_me: bool = False
    is_group: bool = False
    has_media: bool = False
    media_type: Optional[str] = None


class Contact(BaseModel):
    """Represents a WhatsApp contact."""
    jid: str
    name: Optional[str] = None
    push_name: Optional[str] = None
    phone: Optional[str] = None


class SendResult(BaseModel):
    """Result of sending a message."""
    success: bool
    message: str
    message_id: Optional[str] = None


class SearchResult(BaseModel):
    """Result of a message search."""
    messages: List[Message] = []
    total: int = 0


class Stats(BaseModel):
    """WhatsApp bridge statistics."""
    total_chats: int = 0
    total_messages: int = 0
    total_contacts: int = 0
    connected: bool = False
