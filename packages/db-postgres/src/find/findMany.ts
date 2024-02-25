import type { FindArgs } from 'payload/database'
import type { Field, PayloadRequest, TypeWithID } from 'payload/types'

import { inArray, sql } from 'drizzle-orm'

import type { PostgresAdapter } from '../types'
import type { ChainedMethods } from './chainMethods'

import buildQuery from '../queries/buildQuery'
import { transform } from '../transform/read'
import { buildFindManyArgs } from './buildFindManyArgs'
import { chainMethods } from './chainMethods'

type Args = Omit<FindArgs, 'collection'> & {
  adapter: PostgresAdapter
  fields: Field[]
  tableName: string
}

export const findMany = async function find({
  adapter,
  fields,
  limit: limitArg,
  locale,
  page = 1,
  pagination,
  req = {} as PayloadRequest,
  skip,
  sort,
  tableName,
  where: whereArg,
}: Args) {
  const db = adapter.sessions[req.transactionID]?.db || adapter.drizzle
  const table = adapter.tables[tableName]

  const limit = limitArg ?? 10
  let totalDocs: number
  let totalPages: number
  let hasPrevPage: boolean
  let hasNextPage: boolean
  let pagingCounter: number
  let selectDistinctResult

  const { joinAliases, joins, orderBy, selectFields, where } = await buildQuery({
    adapter,
    fields,
    locale,
    sort,
    tableName,
    where: whereArg,
  })

  const orderedIDMap: Record<number | string, number> = {}
  let orderedIDs: (number | string)[]

  const selectDistinctMethods: ChainedMethods = []

  if (orderBy?.order && orderBy?.column) {
    selectDistinctMethods.push({
      args: [orderBy.order(orderBy.column)],
      method: 'orderBy',
    })
  }

  const findManyArgs = buildFindManyArgs({
    adapter,
    depth: 0,
    fields,
    tableName,
  })

  // only fetch IDs when a sort or where query is used that needs to be done on join tables, otherwise these can be done directly on the table in findMany
  if (Object.keys(joins).length > 0 || joinAliases.length > 0) {
    if (where) {
      selectDistinctMethods.push({ args: [where], method: 'where' })
    }

    joinAliases.forEach(({ condition, table }) => {
      selectDistinctMethods.push({
        args: [table, condition],
        method: 'leftJoin',
      })
    })

    Object.entries(joins).forEach(([joinTable, condition]) => {
      if (joinTable) {
        selectDistinctMethods.push({
          args: [adapter.tables[joinTable], condition],
          method: 'leftJoin',
        })
      }
    })

    selectDistinctMethods.push({ args: [skip || (page - 1) * limit], method: 'offset' })
    selectDistinctMethods.push({ args: [limit === 0 ? undefined : limit], method: 'limit' })

    selectDistinctResult = await chainMethods({
      methods: selectDistinctMethods,
      query: db.selectDistinct(selectFields).from(table),
    })

    if (selectDistinctResult.length === 0) {
      return {
        docs: [],
        hasNextPage: false,
        hasPrevPage: false,
        limit,
        nextPage: null,
        page: 1,
        pagingCounter: 0,
        prevPage: null,
        totalDocs: 0,
        totalPages: 0,
      }
    }
    // set the id in an object for sorting later
    selectDistinctResult.forEach(({ id }, i) => {
      orderedIDMap[id as number | string] = i
    })
    orderedIDs = Object.keys(orderedIDMap)
    findManyArgs.where = inArray(adapter.tables[tableName].id, orderedIDs)
  } else {
    findManyArgs.limit = limitArg === 0 ? undefined : limitArg

    const offset = skip || (page - 1) * limitArg

    if (!Number.isNaN(offset)) findManyArgs.offset = offset

    if (where) {
      findManyArgs.where = where
    }
    findManyArgs.orderBy = orderBy.order(orderBy.column)
  }

  const findPromise = db.query[tableName].findMany(findManyArgs)

  if (pagination !== false && (orderedIDs ? orderedIDs?.length >= limit : true)) {
    const selectCountMethods: ChainedMethods = []

    joinAliases.forEach(({ condition, table }) => {
      selectCountMethods.push({
        args: [table, condition],
        method: 'leftJoin',
      })
    })

    Object.entries(joins).forEach(([joinTable, condition]) => {
      if (joinTable) {
        selectCountMethods.push({
          args: [adapter.tables[joinTable], condition],
          method: 'leftJoin',
        })
      }
    })

    const countResult = await chainMethods({
      methods: selectCountMethods,
      query: db
        .select({
          count: sql<number>`count
              (DISTINCT ${adapter.tables[tableName].id})`,
        })
        .from(table)
        .where(where),
    })
    totalDocs = Number(countResult[0].count)
    totalPages = typeof limit === 'number' && limit !== 0 ? Math.ceil(totalDocs / limit) : 1
    hasPrevPage = page > 1
    hasNextPage = totalPages > page
    pagingCounter = (page - 1) * limit + 1
  }

  const rawDocs = await findPromise
  // sort rawDocs from selectQuery
  if (Object.keys(orderedIDMap).length > 0) {
    rawDocs.sort((a, b) => orderedIDMap[a.id] - orderedIDMap[b.id])
  }

  if (pagination === false || !totalDocs) {
    totalDocs = rawDocs.length
    totalPages = 1
    pagingCounter = 1
    hasPrevPage = false
    hasNextPage = false
  }

  const docs = rawDocs.map((data: TypeWithID) => {
    return transform({
      config: adapter.payload.config,
      data,
      fields,
    })
  })

  return {
    docs,
    hasNextPage,
    hasPrevPage,
    limit,
    nextPage: hasNextPage ? page + 1 : null,
    page,
    pagingCounter,
    prevPage: hasPrevPage ? page - 1 : null,
    totalDocs,
    totalPages,
  }
}
