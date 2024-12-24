// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { SolanaSbt } from "../target/types/solana_sbt";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";
import { assert } from "chai";

// const anchor = require("@coral-xyz/anchor");

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

  // Add your deploy script here.
  const program = anchor.workspace.XstarSolanaSbt as Program<SolanaSbt>;

  // Treasury wallet from your program
  const TREASURY_WALLET = new PublicKey("9msUhPoGYz2Wp2c1uhPVvsTQBYhqctVTRmZMNwZerKzk");
  const TOKEN_METADATA_PROGRAM_ID = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);
  let collectionMint: Keypair;
  let collectionMetadata: PublicKey;
  let collectionMasterEdition: PublicKey;
  let configPDA: PublicKey;

  async function init_collection() {
    // Initializes collection
    // Generate collection mint
    collectionMint = Keypair.generate();

    console.log('collection publickey base58', collectionMint.publicKey.toBase58())
    console.log('collection publickey string', collectionMint.publicKey.toString())


    // Find PDA for collection config
    // [configPDA] = PublicKey.findProgramAddressSync(
    //   [Buffer.from("collection_config")],
    //   program.programId
    // );

    // Get PDA addresses for metadata accounts
    const [metadataAddress] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    collectionMetadata = metadataAddress;

    const [masterEditionAddress] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionMint.publicKey.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    collectionMasterEdition = masterEditionAddress;

    // Get associated token account for collection
    const collectionTokenAccount = await anchor.utils.token.associatedAddress({
      mint: collectionMint.publicKey,
      owner: provider.wallet.publicKey,
    });

    try {
      await program.methods
        .initializeCollection(
          "Test Collection",
          "TEST",
          "https://arweave.net/collection-uri"
        )
        .accounts({
          authority: provider.wallet.publicKey,
          // collectionMint: collectionMint.publicKey,
          // collectionTokenAccount: collectionTokenAccount,
          collectionMetadata: collectionMetadata,
          collectionMasterEdition: collectionMasterEdition,
          // config: configPDA,
          // metadataProgram: TOKEN_METADATA_PROGRAM_ID,
          // tokenProgram: TOKEN_PROGRAM_ID,
          // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          // systemProgram: SystemProgram.programId,
          // rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([collectionMint])
        .rpc({
          // preflightCommitment is for transaction simulation
          preflightCommitment: 'processed',
          // commitment is for actual transaction confirmation
          commitment: 'finalized'
        });

      // Verify config account
      const configAccount = await program.account.collectionConfig.fetch(configPDA);
      assert.equal(configAccount.currentId.toString(), "0");
      assert.equal(configAccount.priceLevel1.toString(), "0");
      assert.equal(configAccount.priceLevel2.toString(), "200000000");

      console.log("Initialize Collection done.", collectionMint.publicKey.toBase58())

    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  }

  // await init_collection()

  // mint
  async function mint() {
    const mint = Keypair.generate();
    const metadataAddress = (PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.publicKey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    ))[0];

    const masterEditionAddress = (PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.publicKey.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    ))[0];

    const associatedTokenAccount = await anchor.utils.token.associatedAddress({
      mint: mint.publicKey,
      owner: provider.wallet.publicKey,
    });

    // const initialTreasuryBalance = await provider.connection.getBalance(TREASURY_WALLET);

    await program.methods
      .mintNft("Test NFT", "TEST", "https://raw.githubusercontent.com/687c/solana-nft-native-client/main/metadata.json")
      .accounts({
        payer: provider.wallet.publicKey,
        mint: mint.publicKey,
        // associatedTokenAccount: associatedTokenAccount,
        metadataAccount: metadataAddress,
        masterEditionAccount: masterEditionAddress,
        collectionMint: collectionMint.publicKey,
        collectionMetadata: collectionMetadata,
        // config: configPDA,
        // treasury: TREASURY_WALLET,
        // tokenProgram: TOKEN_PROGRAM_ID,
        // associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        // metadataProgram: METADATA_PROGRAM_ID,
        // systemProgram: SystemProgram.programId,
        // rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mint])
      .rpc({
        preflightCommitment: 'processed',
        commitment: 'finalized'
      });

    // Verify token mint
    const tokenBalance = await provider.connection.getTokenAccountBalance(
      associatedTokenAccount
    );
    assert.equal(tokenBalance.value.uiAmount, 1);

    // Verify counter increment
    const configAccount = await program.account.collectionConfig.fetch(configPDA);
    assert.equal(configAccount.currentId.toString(), "1");
  }

  // await mint()
};