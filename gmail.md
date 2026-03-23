# Gmail Automation Guide

## Description

This library provides utilities to automate Gmail operations including:
1. **Compose & send emails** - Create and send new emails
2. **Read emails** - Extract email content, metadata, and thread information
3. **Reply & forward** - Respond to emails programmatically
4. **Email actions** - Archive, delete, star, mark as read/unread
5. **List & search** - Get inbox emails and search for specific messages
6. **Navigation** - Navigate between folders and open specific emails

**Key Features:**
- Send emails with proper recipient, subject, and body formatting
- Extract complete email metadata (sender, recipients, timestamp, body)
- Perform common Gmail actions (archive, delete, star, etc.)
- List emails from inbox with filtering capabilities
- Search for emails by query

---

## Usage Examples

### Sending a New Email

```javascript
// Send a simple email
await window.gmailUtils.sendEmail({
  to: 'recipient@example.com',
  subject: 'Test Subject',
  body: 'This is the email body content.'
});
```

### Reading Current Email

```javascript
// Read the currently open email
const email = window.gmailUtils.readCurrentEmail();
console.log(email.subject);
console.log(email.from.email);
console.log(email.body);
```

### Listing Inbox Emails

```javascript
// Get all emails from inbox
const emails = window.gmailUtils.listEmails();
emails.forEach(email => {
  console.log(`${email.sender.name}: ${email.subject}`);
});
```

### Replying to Email

```javascript
// Reply to current email
await window.gmailUtils.reply('Thanks for your message!');
```

### Email Actions

```javascript
// Archive current email
window.gmailUtils.archive();

// Star current email
window.gmailUtils.toggleStar();

// Delete current email
window.gmailUtils.delete();

// Mark as unread
window.gmailUtils.markAsUnread();
```

### Searching Emails

```javascript
// Search for emails
await window.gmailUtils.search('from:sender@example.com');
```

---

## Code Library

Install this once per session:

```javascript
window.gmailUtils = {
  
  // Send a new email
  sendEmail: async function({ to, subject = '', body = '', cc = '', bcc = '' }) {
    // Navigate to compose
    window.location.hash = '#inbox?compose=new';
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const composeWindow = document.querySelector('div[role="dialog"]');
    if (!composeWindow) {
      throw new Error('Compose window not found');
    }
    
    // Fill in To field
    const toField = composeWindow.querySelector('input[aria-label="To recipients"]');
    if (toField && to) {
      toField.value = to;
      toField.dispatchEvent(new Event('input', { bubbles: true }));
      toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Fill in Cc if provided
    if (cc) {
      const ccButton = composeWindow.querySelector('[aria-label*="Cc"]');
      if (ccButton) ccButton.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const ccField = composeWindow.querySelector('input[aria-label="Cc recipients"]');
      if (ccField) {
        ccField.value = cc;
        ccField.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    
    // Fill in Subject
    const subjectField = composeWindow.querySelector('input[name="subjectbox"]');
    if (subjectField) {
      subjectField.value = subject;
      subjectField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    // Fill in Body
    const bodyField = composeWindow.querySelector('div[aria-label="Message Body"]');
    if (bodyField) {
      bodyField.focus();
      bodyField.textContent = body;
      bodyField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Send
    const sendButton = composeWindow.querySelector('[aria-label*="Send"]');
    if (sendButton) {
      sendButton.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('Email sent successfully');
      return true;
    }
    
    return false;
  },
  
  // Read currently open email
  readCurrentEmail: function() {
    const emailView = document.querySelector('[role="main"]');
    if (!emailView) return null;
    
    // Get subject
    const subject = document.querySelector('h2')?.textContent?.trim();
    
    // Get sender info
    const senderEmail = document.querySelector('[email]')?.getAttribute('email');
    const senderName = document.querySelector('[email]')?.getAttribute('name') || 
                       document.querySelector('[email]')?.getAttribute('data-name') || 'Unknown';
    
    // Get timestamp
    const timestamp = document.querySelector('span[data-tooltip*=":"]')?.getAttribute('data-tooltip') ||
                     document.querySelector('span[title*=","]')?.getAttribute('title');
    
    // Get email body (clean version)
    const bodyElement = document.querySelector('div[data-message-id] .a3s') ||
                       document.querySelector('.a3s');
    const body = bodyElement?.innerText?.trim() || '';
    
    // Get thread ID from URL
    const threadId = window.location.hash.match(/#[^\/]+\/([^\/]+)/)?.[1];
    
    return {
      threadId,
      subject,
      from: {
        email: senderEmail,
        name: senderName
      },
      timestamp,
      body
    };
  },
  
  // List emails from current view (inbox, starred, etc.)
  listEmails: function() {
    const emailRows = document.querySelectorAll('tr.zA');
    const emails = Array.from(emailRows).map(row => {
      // Get thread/message ID
      const threadId = row.getAttribute('data-thread-id') || 
                       row.getAttribute('data-legacy-thread-id');
      
      // Get sender
      const senderElement = row.querySelector('.yW span[email]');
      const sender = {
        name: senderElement?.getAttribute('name') || senderElement?.textContent || 'Unknown',
        email: senderElement?.getAttribute('email') || ''
      };
      
      // Get subject
      const subjectElement = row.querySelector('.y6 span');
      const subject = subjectElement?.textContent || '';
      
      // Get snippet
      const snippetElement = row.querySelector('.y2');
      const snippet = snippetElement?.textContent || '';
      
      // Get timestamp
      const timeElement = row.querySelector('.xW.xY span');
      const timestamp = timeElement?.getAttribute('title') || timeElement?.textContent || '';
      
      // Check if unread
      const isUnread = row.classList.contains('zE');
      
      // Check if starred
      const isStarred = row.querySelector('[aria-label*="Starred"]') !== null;
      
      return {
        threadId,
        sender,
        subject,
        snippet,
        timestamp,
        isUnread,
        isStarred,
        element: row
      };
    });
    
    return emails;
  },
  
  // Open email by thread ID
  openEmail: async function(threadId) {
    const currentView = window.location.hash.split('/')[0];
    window.location.hash = `${currentView}/${threadId}`;
    await new Promise(resolve => setTimeout(resolve, 1500));
    return true;
  },
  
  // Reply to current email
  reply: async function(message) {
    const replyButton = document.querySelector('[aria-label="Reply"]');
    if (!replyButton) {
      throw new Error('Reply button not found - make sure an email is open');
    }
    
    replyButton.click();
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Fill in reply
    const replyBody = document.querySelector('div[aria-label="Message Body"]');
    if (replyBody) {
      replyBody.focus();
      replyBody.textContent = message;
      replyBody.dispatchEvent(new Event('input', { bubbles: true }));
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Send reply
      const sendButton = document.querySelector('[aria-label*="Send"]');
      if (sendButton) {
        sendButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('Reply sent');
        return true;
      }
    }
    
    return false;
  },
  
  // Archive current email
  archive: function() {
    const archiveButton = document.querySelector('[aria-label="Archive"]');
    if (archiveButton) {
      archiveButton.click();
      console.log('Email archived');
      return true;
    }
    return false;
  },
  
  // Delete current email
  delete: function() {
    const deleteButton = document.querySelector('[aria-label="Delete"]');
    if (deleteButton) {
      deleteButton.click();
      console.log('Email deleted');
      return true;
    }
    return false;
  },
  
  // Toggle star on current email
  toggleStar: function() {
    const starButton = document.querySelector('[data-tooltip*="tar"]');
    if (starButton) {
      starButton.click();
      return true;
    }
    return false;
  },
  
  // Mark current email as unread
  markAsUnread: function() {
    const markButton = document.querySelector('[aria-label*="Mark as unread"]');
    if (markButton) {
      markButton.click();
      return true;
    }
    return false;
  },
  
  // Mark current email as read
  markAsRead: function() {
    const markButton = document.querySelector('[aria-label*="Mark as read"]');
    if (markButton) {
      markButton.click();
      return true;
    }
    return false;
  },
  
  // Search for emails
  search: async function(query) {
    const searchBox = document.querySelector('input[aria-label="Search mail"]');
    if (!searchBox) {
      throw new Error('Search box not found');
    }
    
    searchBox.value = query;
    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Submit search
    searchBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      bubbles: true
    }));
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`Searched for: ${query}`);
    return true;
  },
  
  // Navigate to inbox
  goToInbox: async function() {
    window.location.hash = '#inbox';
    await new Promise(resolve => setTimeout(resolve, 1500));
    return true;
  },
  
  // Navigate to sent folder
  goToSent: async function() {
    window.location.hash = '#sent';
    await new Promise(resolve => setTimeout(resolve, 1500));
    return true;
  },
  
  // Navigate to starred folder
  goToStarred: async function() {
    window.location.hash = '#starred';
    await new Promise(resolve => setTimeout(resolve, 1500));
    return true;
  },
  
  // Navigate to drafts
  goToDrafts: async function() {
    window.location.hash = '#drafts';
    await new Promise(resolve => setTimeout(resolve, 1500));
    return true;
  }
};

return "Gmail utilities installed on window.gmailUtils";
```

---

## Available Actions Summary

| Action | Function | Description |
|--------|----------|-------------|
| **Send Email** | `sendEmail({to, subject, body})` | Compose and send a new email |
| **Read Email** | `readCurrentEmail()` | Extract data from currently open email |
| **List Emails** | `listEmails()` | Get all emails from current view |
| **Open Email** | `openEmail(threadId)` | Open specific email by ID |
| **Reply** | `reply(message)` | Reply to current email |
| **Archive** | `archive()` | Archive current email |
| **Delete** | `delete()` | Delete current email |
| **Star** | `toggleStar()` | Toggle star on current email |
| **Mark Read** | `markAsRead()` | Mark current email as read |
| **Mark Unread** | `markAsUnread()` | Mark current email as unread |
| **Search** | `search(query)` | Search for emails |
| **Go to Inbox** | `goToInbox()` | Navigate to inbox |
| **Go to Sent** | `goToSent()` | Navigate to sent folder |
| **Go to Starred** | `goToStarred()` | Navigate to starred folder |
| **Go to Drafts** | `goToDrafts()` | Navigate to drafts |

---

## Testing Summary

All operations have been tested successfully:

✅ **Send Email** - Sent test email to shuv1337games@gmail.com  
✅ **Read Email** - Extracted subject, sender, body, timestamp  
✅ **List Emails** - Retrieved 4 emails from inbox with metadata  
✅ **Reply** - Replied to test email  
✅ **Star** - Toggled star on email  
✅ **Archive** - Verified archive button works  
✅ **Delete** - Verified delete button works  
✅ **Mark as Read/Unread** - Verified mark buttons work  

## Notes

- Gmail uses dynamic loading, so some operations require waiting for DOM updates
- Thread IDs are extracted from the URL hash (e.g., `#inbox/KtbxLxg...`)
- The utilities handle proper event triggering for Gmail's React-based UI
- Search syntax supports Gmail's advanced search operators (e.g., `from:user@example.com`, `subject:important`)
- Some actions (like labeling) may require opening additional menus and are not included in this basic version
- **Important:** Utilities must be reinstalled in each new browser session (paste the code library once per session)
