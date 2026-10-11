import { Controller, Get, Header, UseFilters } from '@nestjs/common';
import {
  OrgServerOnly,
  ScimAuth,
} from '../../../common/decorators/auth-requirement.decorators';
import { SCIM_CONTENT_TYPE, ScimErrorFilter } from './scim-error';
import {
  GROUP_SCHEMA,
  LIST_SCHEMA,
  MAX_RESULTS,
  USER_SCHEMA,
} from './scim.service';

const list = (Resources: unknown[]) => ({
  schemas: [LIST_SCHEMA],
  totalResults: Resources.length,
  startIndex: 1,
  itemsPerPage: Resources.length,
  Resources,
});

const attribute = (
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  name,
  type: 'string',
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  ...extra,
});

/** The supported attributes only (api.md 67). */
const USER_SCHEMA_RESOURCE = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
  id: USER_SCHEMA,
  name: 'User',
  description: 'User account',
  attributes: [
    attribute('userName', { required: true, uniqueness: 'server' }),
    attribute('externalId', { caseExact: true }),
    attribute('active', { type: 'boolean' }),
    attribute('displayName'),
    attribute('name', {
      type: 'complex',
      subAttributes: [
        attribute('givenName'),
        attribute('familyName'),
        attribute('formatted'),
      ],
    }),
    attribute('emails', {
      type: 'complex',
      multiValued: true,
      subAttributes: [
        attribute('value'),
        attribute('type'),
        attribute('primary', { type: 'boolean' }),
      ],
    }),
  ],
  meta: { resourceType: 'Schema', location: `/scim/v2/Schemas/${USER_SCHEMA}` },
};

const GROUP_SCHEMA_RESOURCE = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
  id: GROUP_SCHEMA,
  name: 'Group',
  description: 'Group',
  attributes: [
    attribute('displayName', { required: true, uniqueness: 'server' }),
    attribute('externalId', { caseExact: true }),
    attribute('members', {
      type: 'complex',
      multiValued: true,
      subAttributes: [
        attribute('value', { mutability: 'immutable' }),
        attribute('display', { mutability: 'readOnly' }),
      ],
    }),
  ],
  meta: {
    resourceType: 'Schema',
    location: `/scim/v2/Schemas/${GROUP_SCHEMA}`,
  },
};

/** SCIM discovery (api.md 65-67). */
@Controller('scim/v2')
@ScimAuth()
@OrgServerOnly()
@UseFilters(ScimErrorFilter)
export class ScimDiscoveryController {
  @Get('ServiceProviderConfig')
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_RESULTS },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'The SCIM token configured on the server',
          primary: true,
        },
      ],
      meta: {
        resourceType: 'ServiceProviderConfig',
        location: '/scim/v2/ServiceProviderConfig',
      },
    };
  }

  @Get('ResourceTypes')
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  resourceTypes() {
    return list([
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        schema: USER_SCHEMA,
        meta: {
          resourceType: 'ResourceType',
          location: '/scim/v2/ResourceTypes/User',
        },
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        schema: GROUP_SCHEMA,
        meta: {
          resourceType: 'ResourceType',
          location: '/scim/v2/ResourceTypes/Group',
        },
      },
    ]);
  }

  @Get('Schemas')
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  schemas() {
    return list([USER_SCHEMA_RESOURCE, GROUP_SCHEMA_RESOURCE]);
  }
}
