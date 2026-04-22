import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Mock auth — no real token requests
jest.unstable_mockModule('../../src/auth.js', async () => ({
  getClientToken: jest.fn().mockResolvedValue('mock-client-token'),
  getUserToken: jest.fn().mockResolvedValue('mock-user-token'),
}));

// Mock api — no real HTTP
const mockSearchProducts    = jest.fn();
const mockSearchLocations   = jest.fn();
const mockAddToCart         = jest.fn();
const mockNearestLocationId = jest.fn();

jest.unstable_mockModule('../../src/api.js', async () => ({
  searchProducts:    mockSearchProducts,
  searchLocations:   mockSearchLocations,
  addToCart:         mockAddToCart,
  nearestLocationId: mockNearestLocationId,
}));

const { createServer } = await import('../../src/server.js');

/** Spin up a server+client pair over InMemoryTransport */
async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

beforeEach(() => {
  mockSearchProducts.mockReset();
  mockSearchLocations.mockReset();
  mockAddToCart.mockReset();
  mockNearestLocationId.mockReset();
});

describe('search_products', () => {
  test('returns formatted product list', async () => {
    mockSearchProducts.mockResolvedValue([
      { brand: 'Kroger', description: 'Whole Milk', upc: '0001111050953', price: '$3.49 (sale: N/A)' },
      { brand: '', description: 'Organic Milk', upc: '0001111051234', price: '$4.99 (sale: N/A)' },
    ]);

    const client = await makeClient();
    const result = await client.callTool({ name: 'search_products', arguments: { query: 'milk' } });

    const text = result.content[0].text;
    expect(text).toContain('Whole Milk');
    expect(text).toContain('Kroger');
    expect(text).toContain('0001111050953');
    expect(mockSearchProducts).toHaveBeenCalledWith('mock-client-token', 'milk', null, 10);
  });

  test('returns no-results message when list is empty', async () => {
    mockSearchProducts.mockResolvedValue([]);

    const client = await makeClient();
    const result = await client.callTool({ name: 'search_products', arguments: { query: 'xyznotaproduct' } });

    expect(result.content[0].text).toContain('No products found');
  });

  test('resolves locationId when zip_code is provided', async () => {
    mockNearestLocationId.mockResolvedValue('loc-123');
    mockSearchProducts.mockResolvedValue([
      { brand: 'Brand', description: 'Item', upc: '111', price: '$1.00' },
    ]);

    const client = await makeClient();
    await client.callTool({ name: 'search_products', arguments: { query: 'milk', zip_code: '85281' } });

    expect(mockNearestLocationId).toHaveBeenCalledWith('mock-client-token', '85281');
    expect(mockSearchProducts).toHaveBeenCalledWith('mock-client-token', 'milk', 'loc-123', 10);
  });
});

describe('find_stores', () => {
  test('returns formatted store list', async () => {
    mockSearchLocations.mockResolvedValue([
      { locationId: 'loc-1', name: 'Kroger #123', address: '100 Main St, Tempe, AZ 85281' },
    ]);

    const client = await makeClient();
    const result = await client.callTool({ name: 'find_stores', arguments: { zip_code: '85281' } });

    const text = result.content[0].text;
    expect(text).toContain('Kroger #123');
    expect(text).toContain('loc-1');
  });

  test('returns no-stores message when empty', async () => {
    mockSearchLocations.mockResolvedValue([]);

    const client = await makeClient();
    const result = await client.callTool({ name: 'find_stores', arguments: { zip_code: '00000' } });

    expect(result.content[0].text).toContain('No Kroger stores found');
  });
});

describe('add_to_cart', () => {
  test('resolves product name to UPC and calls addToCart', async () => {
    mockSearchProducts.mockResolvedValue([
      { brand: 'Kroger', description: 'Butter', upc: '0001111060001', price: '$2.00' },
    ]);
    mockAddToCart.mockResolvedValue({ success: true, message: 'Added 1 item(s) to your Kroger cart.' });

    const client = await makeClient();
    const result = await client.callTool({
      name: 'add_to_cart',
      arguments: { items: [{ product_name_or_upc: 'butter', quantity: 2 }] },
    });

    expect(mockAddToCart).toHaveBeenCalledWith(
      'mock-user-token',
      [{ upc: '0001111060001', quantity: 2 }]
    );
    expect(result.content[0].text).toContain('Added 1 item');
  });

  test('skips UPC resolution when 13-digit UPC is provided', async () => {
    mockAddToCart.mockResolvedValue({ success: true, message: 'Added 1 item(s) to your Kroger cart.' });

    const client = await makeClient();
    await client.callTool({
      name: 'add_to_cart',
      arguments: { items: [{ product_name_or_upc: '0001111060001', quantity: 1 }] },
    });

    expect(mockSearchProducts).not.toHaveBeenCalled();
    expect(mockAddToCart).toHaveBeenCalledWith(
      'mock-user-token',
      [{ upc: '0001111060001', quantity: 1 }]
    );
  });

  test('returns isError when getUserToken returns null', async () => {
    const { getUserToken } = await import('../../src/auth.js');
    getUserToken.mockResolvedValueOnce(null);

    const client = await makeClient();
    const result = await client.callTool({
      name: 'add_to_cart',
      arguments: { items: [{ product_name_or_upc: 'milk' }] },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('authorize');
  });
});
