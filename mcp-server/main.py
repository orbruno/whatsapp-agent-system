"""
WhatsApp MCP Server

Exposes WhatsApp Bridge functionality via the Model Context Protocol (MCP).
Uses FastMCP to provide standardized tools that allow Claude to:
1. List and search chats
2. Read and search messages
3. Send messages
4. Look up contacts
5. Check bridge statistics

Connects to the WhatsApp Bridge HTTP API at localhost:3100.
"""

import sys
import os
from typing import Optional, Dict, Any, List

from mcp.server.fastmcp import FastMCP

from whatsapp import WhatsAppAPI

# Initialize FastMCP server and API client
mcp = FastMCP("whatsapp")
api = WhatsAppAPI(os.getenv("WHATSAPP_API_URL", "http://localhost:3100"))


@mcp.tool()
def list_chats(
    query: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> Dict[str, Any]:
    """List WhatsApp chats, optionally filtered by name.

    Args:
        query: Optional search term to filter chats by name
        limit: Maximum number of chats to return (default 20)
        offset: Number of chats to skip for pagination (default 0)
    """
    return api.list_chats(query=query, limit=limit, offset=offset)


@mcp.tool()
def list_messages(
    chat_id: str,
    query: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    direction: Optional[str] = None,
) -> Dict[str, Any]:
    """Get messages from a specific WhatsApp chat.

    Args:
        chat_id: The JID of the chat to get messages from
        query: Optional search term to filter messages by content
        limit: Maximum number of messages to return (default 50)
        offset: Number of messages to skip for pagination (default 0)
        direction: Optional sort direction ("asc" or "desc")
    """
    return api.list_messages(
        chat_id=chat_id, query=query, limit=limit, offset=offset, direction=direction
    )


@mcp.tool()
def search_messages(
    query: str,
    chat_id: Optional[str] = None,
    limit: int = 20,
) -> Dict[str, Any]:
    """Search WhatsApp messages across all chats or within a specific chat.

    Args:
        query: Search term to find in messages
        chat_id: Optional chat JID to limit search to a specific chat
        limit: Maximum number of results to return (default 20)
    """
    return api.search_messages(query=query, chat_id=chat_id, limit=limit)


@mcp.tool()
def send_message(jid: str, text: str) -> Dict[str, Any]:
    """Send a WhatsApp message to a specific chat.

    Args:
        jid: The JID (chat identifier) to send the message to
        text: The message text to send
    """
    if not jid:
        return {"success": False, "error": "JID must be provided"}
    if not text:
        return {"success": False, "error": "Message text must be provided"}
    return api.send_message(jid=jid, text=text)


@mcp.tool()
def get_contacts(
    query: Optional[str] = None,
    limit: int = 20,
) -> Dict[str, Any]:
    """Get WhatsApp contacts, optionally filtered by name.

    Args:
        query: Optional search term to filter contacts by name
        limit: Maximum number of contacts to return (default 20)
    """
    return api.get_contacts(query=query, limit=limit)


@mcp.tool()
def get_stats() -> Dict[str, Any]:
    """Get WhatsApp bridge statistics including message counts and connection status."""
    return api.get_stats()


if __name__ == "__main__":
    os.makedirs(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs"),
        exist_ok=True,
    )
    sys.stderr = open(
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "logs",
            "mcp_error.log",
        ),
        "w",
    )
    mcp.run(transport="stdio")
