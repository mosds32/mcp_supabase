import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();
// Load environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Create MCP server
const server = new Server(
  {
    name: 'memory-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'create_memory',
        description: 'Create or update a memory entry. Use this when the user shares important information that should be remembered.',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: {
              type: 'string',
              description: 'Unique identifier for the user',
            },
            key: {
              type: 'string',
              description: 'Unique key for this memory (e.g., "favorite_food", "home_address")',
            },
            content: {
              type: 'string',
              description: 'The actual content to remember',
            },
            tag: {
              type: 'string',
              description: 'Optional category tag (e.g., "personal", "work", "medical")',
            },
            metadata: {
              type: 'object',
              description: 'Optional additional structured data',
            },
          },
          required: ['user_id', 'key', 'content'],
        },
      },
      {
        name: 'get_memory',
        description: 'Retrieve a specific memory by key',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: {
              type: 'string',
              description: 'Unique identifier for the user',
            },
            key: {
              type: 'string',
              description: 'The key of the memory to retrieve',
            },
          },
          required: ['user_id', 'key'],
        },
      },
      {
        name: 'list_memories',
        description: 'List all memories for a user, optionally filtered by tag',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: {
              type: 'string',
              description: 'Unique identifier for the user',
            },
            tag: {
              type: 'string',
              description: 'Optional tag to filter by',
            },
            search: {
              type: 'string',
              description: 'Optional search term to filter memories',
            },
          },
          required: ['user_id'],
        },
      },
      {
        name: 'forget_memory',
        description: 'Delete a specific memory',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: {
              type: 'string',
              description: 'Unique identifier for the user',
            },
            key: {
              type: 'string',
              description: 'The key of the memory to delete',
            },
          },
          required: ['user_id', 'key'],
        },
      },
      {
        name: 'list_tags',
        description: 'Get all unique tags used in memories',
        inputSchema: {
          type: 'object',
          properties: {
            user_id: {
              type: 'string',
              description: 'Unique identifier for the user',
            },
          },
          required: ['user_id'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_memory': {
        const { user_id, key, content, tag, metadata } = args as any;

        const { data, error } = await supabase
          .from('memories')
          .upsert(
            {
              user_id,
              memory_key: key,
              content,
              tag: tag || null,
              metadata: metadata || null,
            },
            {
              onConflict: 'user_id,memory_key',
            }
          )
          .select();

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: `Memory '${key}' saved successfully`,
                key,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_memory': {
        const { user_id, key } = args as any;

        const { data, error } = await supabase
          .from('memories')
          .select('*')
          .eq('user_id', user_id)
          .eq('memory_key', key)
          .single();

        if (error && error.code !== 'PGRST116') {
          throw new Error(`Database error: ${error.message}`);
        }

        if (!data) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'not_found',
                  message: `No memory found with key '${key}'`,
                }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                key: data.memory_key,
                content: data.content,
                tag: data.tag,
                metadata: data.metadata,
                created_at: data.created_at,
                updated_at: data.updated_at,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_memories': {
        const { user_id, tag, search } = args as any;

        let query = supabase
          .from('memories')
          .select('memory_key, content, tag, created_at, updated_at')
          .eq('user_id', user_id)
          .order('updated_at', { ascending: false });

        if (tag) {
          query = query.eq('tag', tag);
        }

        if (search) {
          query = query.or(`memory_key.ilike.%${search}%,content.ilike.%${search}%`);
        }

        const { data, error } = await query;

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                count: data.length,
                memories: data,
              }, null, 2),
            },
          ],
        };
      }

      case 'forget_memory': {
        const { user_id, key } = args as any;

        const { error } = await supabase
          .from('memories')
          .delete()
          .eq('user_id', user_id)
          .eq('memory_key', key);

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: `Memory '${key}' deleted successfully`,
                key,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_tags': {
        const { user_id } = args as any;

        const { data, error } = await supabase
          .from('memories')
          .select('tag')
          .eq('user_id', user_id)
          .not('tag', 'is', null);

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }

        // Get unique tags and count
        const tagCounts = data.reduce((acc: any, row: any) => {
          const tag = row.tag;
          acc[tag] = (acc[tag] || 0) + 1;
          return acc;
        }, {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                tags: Object.entries(tagCounts).map(([tag, count]) => ({
                  tag,
                  count,
                })),
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            status: 'error',
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Memory MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
