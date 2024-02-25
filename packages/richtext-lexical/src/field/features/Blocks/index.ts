import type { Block, BlockField } from 'payload/types'

import { baseBlockFields } from 'payload/config'
import { fieldsToJSONSchema, formatLabels, getTranslation } from 'payload/utilities'

import type { FeatureProvider } from '../types'

import { SlashMenuOption } from '../../lexical/plugins/SlashMenu/LexicalTypeaheadMenuPlugin/types'
import { BlockNode } from './nodes/BlocksNode'
import { INSERT_BLOCK_COMMAND } from './plugin/commands'
import { blockPopulationPromiseHOC } from './populationPromise'
import { blockValidationHOC } from './validate'

export type BlocksFeatureProps = {
  blocks: Block[]
}

export const BlocksFeature = (props?: BlocksFeatureProps): FeatureProvider => {
  // Sanitization taken from payload/src/fields/config/sanitize.ts
  if (props?.blocks?.length) {
    props.blocks = props.blocks.map((block) => {
      return {
        ...block,
        fields: block.fields.concat(baseBlockFields),
        labels: !block.labels ? formatLabels(block.slug) : block.labels,
      }
    })
    //  unsanitizedBlock.fields are sanitized in the React component and not here.
    // That's because we do not have access to the payload config here.
  }
  return {
    feature: () => {
      return {
        generatedTypes: {
          modifyOutputSchema: ({ currentSchema, field, interfaceNameDefinitions }) => {
            const blocksField: BlockField = {
              name: field?.name + '_lexical_blocks',
              blocks: props.blocks,
              type: 'blocks',
            }
            // This is only done so that interfaceNameDefinitions sets those block's interfaceNames.
            // we don't actually use the JSON Schema itself in the generated types yet.
            fieldsToJSONSchema({}, [blocksField], interfaceNameDefinitions)

            return currentSchema
          },
        },
        nodes: [
          {
            node: BlockNode,
            populationPromises: [blockPopulationPromiseHOC(props)],
            type: BlockNode.getType(),
            validations: [blockValidationHOC(props)],
          },
        ],
        plugins: [
          {
            Component: () =>
              // @ts-expect-error
              import('./plugin').then((module) => module.BlocksPlugin),
            position: 'normal',
          },
        ],
        props: props,
        slashMenu: {
          options: [
            {
              displayName: 'Blocks',
              key: 'blocks',
              options: [
                ...props.blocks.map((block) => {
                  return new SlashMenuOption('block-' + block.slug, {
                    Icon: () =>
                      // @ts-expect-error
                      import('../../lexical/ui/icons/Block').then((module) => module.BlockIcon),
                    displayName: ({ i18n }) => {
                      return getTranslation(block.labels.singular, i18n)
                    },
                    keywords: ['block', 'blocks', block.slug],
                    onSelect: ({ editor }) => {
                      editor.dispatchCommand(INSERT_BLOCK_COMMAND, {
                        id: null,
                        blockName: '',
                        blockType: block.slug,
                      })
                    },
                  })
                }),
              ],
            },
          ],
        },
      }
    },
    key: 'blocks',
  }
}
