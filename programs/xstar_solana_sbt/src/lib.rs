use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{
        create_master_edition_v3, create_metadata_accounts_v3, mpl_token_metadata,
        set_and_verify_sized_collection_item, sign_metadata, update_metadata_accounts_v2,
        CreateMasterEditionV3, CreateMetadataAccountsV3, Metadata, SetAndVerifySizedCollectionItem,
        SignMetadata, UpdateMetadataAccountsV2,
    },
    token::{mint_to, Mint, MintTo, Token, TokenAccount},
    token_2022::{
        mint_to as token_2022_mint_to, MintTo as Token2022MintTo, Token2022, ID as Token2022ID,
    },
    token_2022_extensions::{non_transferable_mint_initialize, NonTransferableMintInitialize},
};
use std::mem::size_of;
use std::str::FromStr;

use mpl_token_metadata::accounts::{MasterEdition, Metadata as MetadataAccount};
use mpl_token_metadata::types::{Collection, CollectionDetails, Creator, DataV2, UseMethod, Uses};

declare_id!("8nQ4PwDCH3uWrdjZ7YPVGKhkbbmfh4QAFgfvJzmJBJSK");

pub const TREASURY_WALLET: &str = "9msUhPoGYz2Wp2c1uhPVvsTQBYhqctVTRmZMNwZerKzk";

// #[constant]
// pub const SEED: &str = "collection";
pub const COLLECTION_SEED: &[u8] = b"collection";
// pub const FREEZE_AUTHORITY_SEED: &[u8] = b"freeze";

#[program]
pub mod solana_sbt {

    use anchor_spl::metadata::set_and_verify_sized_collection_item;

    use super::*;

    pub fn initialize_collection(
        ctx: Context<InitializeCollection>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        ctx.accounts.config.set_inner(CollectionConfig {
            current_id: 0,
            authority: ctx.accounts.authority.key(),
            // Set level thresholds
            level1: 0,
            level2: 5000,
            level3: 20000,
            level4: 50000,
            level5: 100000,
            // Set prices in lamports (example prices)
            price_level1: 0,           // 0 SOL
            price_level2: 200_000_000, // 0.2 SOL
            price_level3: 300_000_000, // 0.3 SOL
            price_level4: 400_000_000, // 0.4 SOL
            price_level5: 500_000_000, // 0.5 SOL
        });

        // PDA for signing
        let signer_seeds: &[&[&[u8]]] = &[&[COLLECTION_SEED, &[ctx.bumps.collection_mint]]];

        // Mint one token for collection NFT
        let cpi_context_1 = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.collection_mint.to_account_info(),
                to: ctx.accounts.collection_token_account.to_account_info(),
                authority: ctx.accounts.collection_mint.to_account_info(),
            },
            &signer_seeds,
        );
        mint_to(cpi_context_1, 1)?;

        // Create metadata account
        let cpi_context_2 = CpiContext::new_with_signer(
            ctx.accounts.metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.collection_metadata.to_account_info(),
                mint: ctx.accounts.collection_mint.to_account_info(),
                mint_authority: ctx.accounts.collection_mint.to_account_info(), // use pda mint address as mint authority
                update_authority: ctx.accounts.collection_mint.to_account_info(), // use pda mint as update authority
                payer: ctx.accounts.authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &signer_seeds,
        );

        let data_v2 = DataV2 {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: Some(vec![Creator {
                address: ctx.accounts.authority.key(),
                verified: false,
                share: 100,
            }]),
            collection: None,
            uses: None,
        };

        create_metadata_accounts_v3(
            cpi_context_2,
            data_v2,
            true,
            true,
            Some(CollectionDetails::V1 { size: 0 }), // set as collection nft
        )?;

        // Create master edition account
        let cpi_context_3 = CpiContext::new_with_signer(
            ctx.accounts.metadata_program.to_account_info(),
            CreateMasterEditionV3 {
                edition: ctx.accounts.collection_master_edition.to_account_info(),
                mint: ctx.accounts.collection_mint.to_account_info(),
                update_authority: ctx.accounts.collection_mint.to_account_info(),
                mint_authority: ctx.accounts.collection_mint.to_account_info(),
                payer: ctx.accounts.authority.to_account_info(),
                metadata: ctx.accounts.collection_metadata.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &signer_seeds,
        );

        create_master_edition_v3(cpi_context_3, Some(0))?;

        // verify creator on metadata account
        sign_metadata(CpiContext::new(
            ctx.accounts.metadata_program.to_account_info(),
            SignMetadata {
                creator: ctx.accounts.authority.to_account_info(),
                metadata: ctx.accounts.collection_metadata.to_account_info(),
            },
        ))?;

        Ok(())
    }

    pub fn mint_nft(
        ctx: Context<MintNFT>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        // Check treasury is correct
        require!(
            ctx.accounts.treasury.key() == Pubkey::from_str(TREASURY_WALLET).unwrap(),
            NftError::InvalidTreasury
        );

        // Check and collect SOL fee
        let mint_price = ctx.accounts.config.get_price();
        require!(
            ctx.accounts.payer.lamports() >= mint_price,
            NftError::InsufficientFunds
        );

        // TODO: 加不加as_ref()的区别
        let signer_seeds: &[&[&[u8]]] =
            &[&[COLLECTION_SEED.as_ref(), &[ctx.bumps.collection_mint]]];

        // create mint account
        let cpi_context_1 = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.associated_token_account.to_account_info(),
                authority: ctx.accounts.collection_mint.to_account_info(),
            },
            signer_seeds, // TODO: 为什么这里没有加 &
        );

        mint_to(cpi_context_1, 1)?;

        // non_transferable_mint_initialize(CpiContext::new(
        //     ctx.accounts.token_2022_program.to_account_info(),
        //     NonTransferableMintInitialize {
        //         token_program_id: ctx.accounts.token_2022_program.to_account_info(),
        //         mint: ctx.accounts.mint.to_account_info(),
        //     },
        // ))?;

        // token_2022_mint_to(
        //     CpiContext::new_with_signer(
        //         ctx.accounts.token_2022_program.to_account_info(),
        //         Token2022MintTo {
        //             mint: ctx.accounts.mint.to_account_info(),
        //             to: ctx.accounts.associated_token_account.to_account_info(),
        //             authority: ctx.accounts.collection_mint.to_account_info(),
        //         },
        //         signer_seeds,
        //     ),
        //     1,
        // )?;

        // create metadata account
        let cpi_context_2 = CpiContext::new_with_signer(
            ctx.accounts.metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                mint_authority: ctx.accounts.collection_mint.to_account_info(),
                update_authority: ctx.accounts.collection_mint.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &signer_seeds,
        );

        // // Get next token ID
        let token_id = ctx.accounts.config.current_id;

        // Increment counter
        ctx.accounts.config.current_id = ctx
            .accounts
            .config
            .current_id
            .checked_add(1)
            .ok_or(NftError::Overflow)?;

        // Use token_id in your NFT metadata
        let nft_name = format!("{} #{}", name, token_id);

        let data_v2 = DataV2 {
            name: nft_name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            // collection: None,
            collection: Some(Collection {
                verified: true,
                key: ctx.accounts.collection_mint.key(),
            }),
            uses: None, // uses: Some(Uses {
                        //     use_method: UseMethfalseod::Single,
                        //     remaining: 1,
                        //     total: 1,
                        // }), // Makes it soulbound ???
        };

        create_metadata_accounts_v3(cpi_context_2, data_v2, true, true, None)?;

        //create master edition account
        let cpi_context_3 = CpiContext::new_with_signer(
            ctx.accounts.metadata_program.to_account_info(),
            CreateMasterEditionV3 {
                edition: ctx.accounts.master_edition_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                update_authority: ctx.accounts.collection_mint.to_account_info(),
                mint_authority: ctx.accounts.collection_mint.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                metadata: ctx.accounts.metadata_account.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &signer_seeds,
        );

        create_master_edition_v3(cpi_context_3, None)?;

        // verify nft as part of collection
        set_and_verify_sized_collection_item(
            CpiContext::new_with_signer(
                ctx.accounts.metadata_program.to_account_info(),
                SetAndVerifySizedCollectionItem {
                    payer: ctx.accounts.payer.to_account_info(),
                    metadata: ctx.accounts.metadata_account.to_account_info(),
                    // FIXME:
                    collection_authority: ctx.accounts.collection_mint.to_account_info(),
                    update_authority: ctx.accounts.collection_mint.to_account_info(),
                    collection_mint: ctx.accounts.collection_mint.to_account_info(),
                    collection_metadata: ctx.accounts.collection_metadata.to_account_info(),
                    collection_master_edition: ctx
                        .accounts
                        .collection_master_edition
                        .to_account_info(),
                },
                &signer_seeds,
            ),
            None,
        )?;

        Ok(())
    }

    pub fn get_current_price(ctx: Context<GetPrice>) -> Result<u64> {
        Ok(ctx.accounts.config.get_price())
    }

    pub fn update_prices(
        ctx: Context<UpdatePrices>,
        new_price1: u64,
        new_price2: u64,
        new_price3: u64,
        new_price4: u64,
        new_price5: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.price_level1 = new_price1;
        config.price_level2 = new_price2;
        config.price_level3 = new_price3;
        config.price_level4 = new_price4;
        config.price_level5 = new_price5;
        Ok(())
    }

    pub fn update_metadata(ctx: Context<UpdateMetadata>, uri: String) -> Result<()> {
        // PDA for signing
        let signer_seeds: &[&[&[u8]]] = &[&[COLLECTION_SEED, &[ctx.bumps.collection_mint]]];

        // 这里是这么更新到某个用户的nft的 ？

        update_metadata_accounts_v2(
            // TODO: 是否需要new_with_signer?
            CpiContext::new(
                ctx.accounts.metadata_program.to_account_info(),
                UpdateMetadataAccountsV2 {
                    metadata: ctx.accounts.metadata_program.to_account_info(),
                    update_authority: ctx.accounts.collection_mint.to_account_info()
                },
            ),
            Some(ctx.accounts.collection_mint.key()),
            Some(
                DataV2 {
                    name: "updated nft".to_string(),
                    symbol: "TEST".to_string(),
                    uri,
                    seller_fee_basis_points: 0,
                    creators: None,
                    collection: Some(Collection {
                        verified: true,
                        key: ctx.accounts.collection_mint.key(),
                    }),
                    uses: None,
                },
            ),
            Some(false),
            Some(true)
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeCollection<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init, // FIXME: init_if_need 会报错？
        seeds = [COLLECTION_SEED],
        bump,
        payer = authority,
        mint::decimals = 0,
        mint::authority = collection_mint,
        mint::freeze_authority = collection_mint,
    )]
    pub collection_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = collection_mint,
        associated_token::authority = authority,
    )]
    pub collection_token_account: Account<'info, TokenAccount>,

    /// CHECK: Metadata account
    #[account(
        mut,
        address = MetadataAccount::find_pda(&collection_mint.key()).0
    )]
    pub collection_metadata: UncheckedAccount<'info>,

    /// CHECK: Master edition account
    #[account(
        mut,
        address = MasterEdition::find_pda(&collection_mint.key()).0
    )]
    pub collection_master_edition: UncheckedAccount<'info>,

    #[account(
        init, // FIXME: init_if_need 会导致 AccessViolation error
        payer = authority,
        space = size_of::<CollectionConfig>() + 8,
        seeds = [b"collection_config"],
        bump
    )]
    pub config: Account<'info, CollectionConfig>,

    pub metadata_program: Program<'info, Metadata>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintNFT<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [COLLECTION_SEED.as_ref()], // TODO: 加不加as_ref()的区别 ？
        bump,
    )]
    pub collection_mint: Account<'info, Mint>,

    /// CHECK:
    #[account(
        mut,
        address=MetadataAccount::find_pda(&collection_mint.key()).0
    )]
    pub collection_metadata: UncheckedAccount<'info>,

    /// CHECK:
    #[account(
        mut,
        address=MasterEdition::find_pda(&collection_mint.key()).0
    )]
    pub collection_master_edition: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        mint::decimals = 0,
        mint::authority = collection_mint,
        mint::freeze_authority = collection_mint,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = payer,
    )]
    pub associated_token_account: Account<'info, TokenAccount>, // new

    /// CHECK:
    #[account(
            mut,
            address=MetadataAccount::find_pda(&mint.key()).0,
        )]
    pub metadata_account: UncheckedAccount<'info>, // new

    /// CHECK:
    #[account(
            mut,
            address= MasterEdition::find_pda(&mint.key()).0,
        )]
    pub master_edition_account: UncheckedAccount<'info>, // new

    #[account(
        mut,
        seeds = [b"collection_config"],
        bump,
    )]
    pub config: Account<'info, CollectionConfig>,

    /// CHECK: Treasury wallet
    #[account(
        mut,
        address = Pubkey::from_str(TREASURY_WALLET).unwrap() @ NftError::InvalidTreasury
    )]
    pub treasury: AccountInfo<'info>,

    pub token_program: Program<'info, Token>, // new
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>, // new
    pub metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>, // bew
    pub rent: Sysvar<'info, Rent>,              // new
}

#[derive(Accounts)]
pub struct GetPrice<'info> {
    #[account(
        seeds = [b"collection_config"],
        bump,
    )]
    pub config: Account<'info, CollectionConfig>,
}

#[derive(Accounts)]
pub struct UpdatePrices<'info> {
    #[account(
        mut,
        constraint = config.authority == authority.key() @ NftError::UnauthorizedAccess
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"collection_config"],
        bump,
    )]
    pub config: Account<'info, CollectionConfig>,
}

#[derive(Accounts)]
pub struct UpdateMetadata<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [COLLECTION_SEED.as_ref()], // TODO: 加不加as_ref()的区别 ？
        bump,
    )]
    pub collection_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>, // new
    pub metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>, // bew
    pub rent: Sysvar<'info, Rent>,              // new
}

#[error_code]
pub enum NftError {
    #[msg("Insufficient funds for minting")]
    InsufficientFunds,
    #[msg("Invalid treasury address")]
    InvalidTreasury,
    #[msg("Counter overflow")]
    Overflow,
    #[msg("Unauthorized access")]
    UnauthorizedAccess,
}

#[account]
pub struct CollectionConfig {
    current_id: u64,
    authority: Pubkey,
    // Store level thresholds
    level1: u64, // 0
    level2: u64, // 5000
    level3: u64, // 20000
    level4: u64, // 50000
    level5: u64, // 100000
    // Store prices for each level (in lamports)
    price_level1: u64,
    price_level2: u64,
    price_level3: u64,
    price_level4: u64,
    price_level5: u64,
}

impl CollectionConfig {
    // Move the pricing logic into the struct implementation
    pub fn get_price(&self) -> u64 {
        if self.current_id >= self.level5 {
            self.price_level5
        } else if self.current_id >= self.level4 {
            self.price_level4
        } else if self.current_id >= self.level3 {
            self.price_level3
        } else if self.current_id >= self.level2 {
            self.price_level2
        } else {
            self.price_level1
        }
    }
}
